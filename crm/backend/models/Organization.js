const mongoose = require('mongoose')

const orgSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  type: { type: String, enum: ['Engineering', 'Management', 'Medical', 'Arts & Science', 'Law', 'Pharmacy', 'Architecture', 'University'], default: 'Engineering' },
  location: { type: String, required: true },
  website: String,
  description: String,
  plan: { type: String, enum: ['free', 'pro', 'enterprise'], default: 'free' },
  logoUrl: String,
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

module.exports = mongoose.model('Organization', orgSchema)
