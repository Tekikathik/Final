const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')

const userSchema = new mongoose.Schema({
  orgId: { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  // 'admin'         — main-branch / head-office: org-wide access, manages branches & officers
  // 'college_admin' — restricted to specific branches via collegeIds (legacy multi-branch admin)
  // 'officer'       — branch officer: works leads/calls within their own branch only
  // 'student'       — prospective student: books campus appointments, sees only their own data
  // 'viewer'        — read-only
  role: { type: String, enum: ['admin', 'college_admin', 'officer', 'student', 'viewer'], default: 'officer' },
  // Branches a college_admin oversees (legacy). For an officer/student, branchId below is the home branch.
  collegeIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'College' }],
  // The officer's / student's home branch (a College acting as a Branch). Null for org-wide admins.
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', default: null, index: true },
  phone: String,
  refreshToken: { type: String, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

userSchema.methods.comparePassword = function (plain) {
  return bcrypt.compare(plain, this.passwordHash)
}

userSchema.pre('save', async function () {
  if (!this.isModified('passwordHash')) return
  this.passwordHash = await bcrypt.hash(this.passwordHash, 12)
})

module.exports = mongoose.model('User', userSchema)
