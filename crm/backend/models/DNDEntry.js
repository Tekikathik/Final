const mongoose = require('mongoose')

// Org-scoped Do-Not-Call registry. Any phone here is blocked from calling
// (India DND/TRAI compliance). Populated by opt-outs, manual flags, or imports.
const dndSchema = new mongoose.Schema({
  orgId:  { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  phone:  { type: String, required: true },          // normalised E.164
  reason: { type: String, default: '' },             // 'opt_out' | 'trai_dnd' | 'manual'
  addedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
}, { timestamps: true })

dndSchema.index({ orgId: 1, phone: 1 }, { unique: true })

module.exports = mongoose.model('DNDEntry', dndSchema)
