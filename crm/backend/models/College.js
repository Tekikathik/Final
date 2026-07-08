const mongoose = require('mongoose')

const courseSchema = new mongoose.Schema({
  name: String,
  fee: Number,
  seats: Number,
  duration: String,
})

// A "College" doubles as a BRANCH OFFICE in the CRM: the head office (main branch)
// plus regional branch offices across states. Officers and students belong to one.
const collegeSchema = new mongoose.Schema({
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  name: { type: String, required: true, trim: true },
  code: { type: String, required: true, uppercase: true, trim: true },
  location: { type: String, default: '' },
  state: { type: String, default: '' },                 // branch office state (multi-state org)
  isHeadOffice: { type: Boolean, default: false },       // the main branch / head office
  phone: { type: String, default: '' },
  address: { type: String, default: '' },
  courses: [courseSchema],
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

module.exports = mongoose.model('College', collegeSchema)
