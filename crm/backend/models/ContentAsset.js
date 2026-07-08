const mongoose = require('mongoose')

// A reusable piece of marketing copy produced by the Content Generation agent
// (or written by a human). Approval-gated: anything with a fee/scholarship claim
// MUST be human-reviewed before it can be used in a send (compliance).
const KINDS = ['whatsapp', 'sms', 'email', 'social', 'brochure']
const LANGS = ['english', 'telugu', 'hindi', 'mixed']
const STATUSES = ['draft', 'pending_review', 'approved', 'rejected', 'archived']

// A factual claim in the copy tied back to the RAG knowledge base (so a reviewer
// can verify "highest package ₹27L" actually came from a source, not the LLM).
const groundingSchema = new mongoose.Schema({
  claim:  { type: String, required: true },
  source: { type: String, default: '' },   // KB doc id / title returned by vectorStore.search
}, { _id: false })

const contentAssetSchema = new mongoose.Schema({
  orgId:    { type: mongoose.Schema.Types.ObjectId, ref: 'Organization', required: true, index: true },
  branchId: { type: mongoose.Schema.Types.ObjectId, ref: 'College', default: null, index: true }, // null = org-wide

  kind:     { type: String, enum: KINDS, required: true },
  language: { type: String, enum: LANGS, default: 'mixed' },
  title:    { type: String, required: true },
  purpose:  { type: String, default: '' },   // the campaign angle this serves

  subject:  { type: String, default: '' },   // email only
  body:     { type: String, required: true },
  // Placeholder tokens the renderer fills per lead, e.g. ['name','program','branch'].
  variables: [{ type: String }],

  // Compliance: a fee/scholarship/number claim forces the review gate.
  containsFeeClaim: { type: Boolean, default: false },
  grounding:        [groundingSchema],

  status:      { type: String, enum: STATUSES, default: 'draft', index: true },
  generatedBy: { type: String, enum: ['agent', 'user'], default: 'agent' },
  authoredBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedBy:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  reviewedAt:  { type: Date, default: null },
  reviewNotes: { type: String, default: '' },
  usedLlm:     { type: Boolean, default: false },

  usageCount: { type: Number, default: 0 },
}, { timestamps: true })

contentAssetSchema.statics.KINDS = KINDS
contentAssetSchema.statics.LANGS = LANGS
contentAssetSchema.statics.STATUSES = STATUSES

module.exports = mongoose.model('ContentAsset', contentAssetSchema)
