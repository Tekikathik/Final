// ---------------------------------------------------------------------------
// Appointments — campus-visit booking + visited/no-show tracking + reminders.
//   POST  /api/appointments              book (student self, or officer for a lead)
//   GET   /api/appointments              list (scoped by role)
//   PATCH /api/appointments/:id/status   mark visited / no_show / cancelled
//   POST  /api/appointments/:id/remind   send a reminder now
// ---------------------------------------------------------------------------
const router = require('express').Router()
const Appointment = require('../models/Appointment')
const Lead = require('../models/Lead')
const College = require('../models/College')
const { authenticate, requireRole } = require('../middleware/auth')
const { audit, branchScopeFilter } = require('../middleware/audit')
const reminders = require('../services/reminders')
const { normalizeIndianPhone } = require('../utils/phone')

router.use(authenticate)

// ── Book ──────────────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  try {
    const u = req.user
    const { leadId, scheduledFor, mode = 'campus_visit', notes = '' } = req.body
    if (!scheduledFor) return res.status(400).json({ message: 'scheduledFor is required' })

    let branchId, studentName, studentPhone, studentEmail, lead = null, studentUserId = null

    if (u.role === 'student') {
      // Students book for themselves into their home branch.
      branchId = u.branchId
      studentUserId = u.userId
      const User = require('../models/User')
      const me = await User.findById(u.userId).select('name phone email branchId').lean()
      studentName = me?.name; studentPhone = me?.phone; studentEmail = me?.email
      branchId = branchId || me?.branchId
      if (!branchId) return res.status(400).json({ message: 'No branch assigned to your account' })
      // Link to an existing lead by phone if there is one.
      if (studentPhone) {
        const norm = normalizeIndianPhone(studentPhone)
        if (norm.ok) lead = await Lead.findOne({ orgId: u.orgId, phone: norm.phone })
      }
    } else {
      // Officer/admin books for a lead.
      if (!leadId) return res.status(400).json({ message: 'leadId is required' })
      lead = await Lead.findOne(branchScopeFilter(req, { _id: leadId }))
      if (!lead) return res.status(404).json({ message: 'Lead not found in your scope' })
      branchId = lead.branchId
      studentName = lead.name; studentPhone = lead.phone; studentEmail = lead.email
    }

    const appt = await Appointment.create({
      orgId: u.orgId, branchId, leadId: lead?._id || null, studentUserId,
      studentName, studentPhone, studentEmail,
      scheduledFor: new Date(scheduledFor), mode, notes,
      createdBy: u.userId, createdByRole: u.role,
    })

    // Move the linked lead into the AppointmentBooked stage.
    if (lead && !['Visited', 'Enrolled'].includes(lead.status)) {
      const prev = lead.status
      lead.status = 'AppointmentBooked'
      lead.statusHistory.push({ status: 'AppointmentBooked', by: u.userId, note: 'appointment booked' })
      await lead.save()
      audit(req, { action: 'lead.status_change', entity: 'Lead', entityId: lead._id, branchId,
        meta: { from: prev, to: 'AppointmentBooked', via: 'appointment' } })
    }

    audit(req, { action: 'appointment.book', entity: 'Appointment', entityId: appt._id, branchId,
      meta: { scheduledFor: appt.scheduledFor, mode } })
    res.status(201).json(appt)
  } catch (err) { console.error('[appointments.book]', err); res.status(500).json({ message: err.message }) }
})

// ── List (scoped) ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const u = req.user
    let filter
    if (u.role === 'student') filter = { orgId: u.orgId, studentUserId: u.userId }
    else filter = branchScopeFilter(req)
    if (req.query.status) filter.status = req.query.status
    if (req.query.branchId && (u.role === 'admin' || u.role === 'college_admin')) filter.branchId = req.query.branchId

    const items = await Appointment.find(filter).sort({ scheduledFor: 1 })
      .populate('branchId', 'name code state').populate('leadId', 'name phone status').lean()
    res.json(items)
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Mark visited / no_show / cancelled ────────────────────────────────────────
router.patch('/:id/status', requireRole('admin', 'college_admin', 'officer'), async (req, res) => {
  try {
    const { status } = req.body
    if (!Appointment.STATUSES.includes(status)) {
      return res.status(400).json({ message: `Invalid status. One of: ${Appointment.STATUSES.join(', ')}` })
    }
    const appt = await Appointment.findOne(branchScopeFilter(req, { _id: req.params.id }))
    if (!appt) return res.status(404).json({ message: 'Appointment not found' })
    appt.status = status
    await appt.save()

    // Close the loop on the lead: visited → Visited stage.
    if (status === 'visited' && appt.leadId) {
      const lead = await Lead.findById(appt.leadId)
      if (lead && !['Enrolled'].includes(lead.status)) {
        const prev = lead.status
        lead.status = 'Visited'
        lead.statusHistory.push({ status: 'Visited', by: req.user.userId, note: 'marked visited' })
        await lead.save()
        audit(req, { action: 'lead.status_change', entity: 'Lead', entityId: lead._id, branchId: lead.branchId,
          meta: { from: prev, to: 'Visited', via: 'appointment' } })
      }
    }
    audit(req, { action: 'appointment.status', entity: 'Appointment', entityId: appt._id, branchId: appt.branchId,
      meta: { status } })
    res.json({ ok: true, status: appt.status })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

// ── Send a reminder now ───────────────────────────────────────────────────────
router.post('/:id/remind', requireRole('admin', 'college_admin', 'officer'), async (req, res) => {
  try {
    const appt = await Appointment.findOne(branchScopeFilter(req, { _id: req.params.id }))
    if (!appt) return res.status(404).json({ message: 'Appointment not found' })
    const branch = await College.findById(appt.branchId).select('name').lean()
    const result = await reminders.sendAppointmentReminder(appt, { branchName: branch?.name })
    appt.reminders.push({ channel: result.channel, status: result.status, detail: result.detail })
    appt.reminderSent = appt.reminderSent || result.status === 'sent'
    if (appt.status === 'booked' && result.status === 'sent') appt.status = 'reminded'
    await appt.save()
    audit(req, { action: 'appointment.remind', entity: 'Appointment', entityId: appt._id, branchId: appt.branchId, meta: result })
    res.json({ ok: true, result })
  } catch (err) { res.status(500).json({ message: err.message }) }
})

module.exports = router
