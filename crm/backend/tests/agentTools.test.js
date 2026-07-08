jest.mock('../services/vectorStore', () => ({
  search: jest.fn(async (query, topK = 3) => ([
    { source: 'fee_doc', text: `Fee facts for: ${query}`, score: 0.9 },
  ])),
}))

const agentTools = require('../services/agentTools')
const vectorStore = require('../services/vectorStore')

describe('agentTools — validateField', () => {
  it('accepts marks within 0-100 (percentage or CGPA)', () => {
    expect(agentTools.validateField('marks_10', '85').ok).toBe(true)
    expect(agentTools.validateField('marks_inter', '8.5').ok).toBe(true)
    expect(agentTools.validateField('marks_10', '0').ok).toBe(true)
    expect(agentTools.validateField('marks_10', '100').ok).toBe(true)
  })

  it('rejects marks outside 0-100', () => {
    expect(agentTools.validateField('marks_10', '-1').ok).toBe(false)
    expect(agentTools.validateField('marks_inter', '101').ok).toBe(false)
    expect(agentTools.validateField('marks_10', 'not-a-number').ok).toBe(false)
  })

  it('normalizes vague / filler marks phrasing to a percentage', () => {
    expect(agentTools.validateField('marks_inter', 'around 71')).toEqual({ ok: true, value: '71%' })
    expect(agentTools.validateField('marks_10', 'like 65 percent')).toEqual({ ok: true, value: '65%' })
    expect(agentTools.validateField('marks_inter', '71 ish')).toEqual({ ok: true, value: '71%' })
    expect(agentTools.extractMarksValue('it\'s around 71')).toBe('71%')
    expect(agentTools.extractMarksValue('no number here')).toBeNull()
    // CGPA (≤ 10) is kept bare, not turned into a percentage.
    expect(agentTools.validateField('marks_inter', '8.5')).toEqual({ ok: true, value: '8.5' })
  })

  it('enforces name length bounds', () => {
    expect(agentTools.validateField('student_name', 'A').ok).toBe(false)
    expect(agentTools.validateField('student_name', 'Rajesh Kumar').ok).toBe(true)
    expect(agentTools.validateField('parent_name', 'x'.repeat(51)).ok).toBe(false)
  })

  it('enforces enums for caller_type, relation, transport_need', () => {
    expect(agentTools.validateField('caller_type', 'student').ok).toBe(true)
    expect(agentTools.validateField('caller_type', 'teacher').ok).toBe(false)

    expect(agentTools.validateField('relation', 'father').ok).toBe(true)
    expect(agentTools.validateField('relation', 'uncle').ok).toBe(false)

    expect(agentTools.validateField('transport_need', 'hostel').ok).toBe(true)
    expect(agentTools.validateField('transport_need', 'walking').ok).toBe(false)
  })

  it('rejects unknown fields', () => {
    expect(agentTools.validateField('favourite_color', 'blue').ok).toBe(false)
  })
})

describe('agentTools — getRequiredFields / getMissingFields', () => {
  it('requires student_name (not parent fields) for a student caller', () => {
    const required = agentTools.getRequiredFields({ caller_type: 'student' })
    expect(required).toContain('student_name')
    expect(required).not.toContain('parent_name')
    expect(required).not.toContain('relation')
  })

  it('additionally requires parent_name and relation for a parent caller', () => {
    const required = agentTools.getRequiredFields({ caller_type: 'parent' })
    expect(required).toContain('parent_name')
    expect(required).toContain('relation')
    expect(required).toContain('student_name')
  })

  it('reports only the fields not yet collected', () => {
    const session = {
      collected: {
        caller_type: 'student',
        student_name: 'Rajesh',
        marks_10: '85',
        marks_inter: '78',
      },
    }
    const missing = agentTools.getMissingFields(session)
    expect(missing).toContain('interest')
    expect(missing).toContain('department')
    expect(missing).toContain('location')
    expect(missing).not.toContain('student_name')
    expect(missing).not.toContain('marks_10')
  })
})

describe('agentTools — deriveStep', () => {
  it('returns greeting (0) when caller_type is unknown', () => {
    expect(agentTools.deriveStep({ collected: {} })).toEqual({ step: 'greeting', step_index: 0 })
  })

  it('returns name (1) until student_name is known', () => {
    expect(agentTools.deriveStep({ collected: { caller_type: 'student' } }))
      .toEqual({ step: 'name', step_index: 1 })
  })

  it('requires parent_name + relation + student_name for a parent caller', () => {
    expect(agentTools.deriveStep({ collected: { caller_type: 'parent', parent_name: 'Suresh' } }))
      .toEqual({ step: 'name', step_index: 1 })

    expect(agentTools.deriveStep({
      collected: { caller_type: 'parent', parent_name: 'Suresh', relation: 'father', student_name: 'Rajesh' },
    })).toEqual({ step: '10th', step_index: 2 })
  })

  it('progresses through marks → course → fee → scholarship → location → transport → queries → end', () => {
    const base = { caller_type: 'student', student_name: 'Rajesh' }

    expect(agentTools.deriveStep({ collected: base })).toEqual({ step: '10th', step_index: 2 })
    expect(agentTools.deriveStep({ collected: { ...base, marks_10: '85' } })).toEqual({ step: 'inter', step_index: 3 })
    expect(agentTools.deriveStep({ collected: { ...base, marks_10: '85', marks_inter: '78' } }))
      .toEqual({ step: 'course', step_index: 4 })

    const withCourse = { ...base, marks_10: '85', marks_inter: '78', interest: 'B.Tech', department: 'CSE' }
    expect(agentTools.deriveStep({ collected: withCourse })).toEqual({ step: 'fee', step_index: 5 })

    const packageShared = { ...withCourse, _packageShared: true }
    expect(agentTools.deriveStep({ collected: packageShared })).toEqual({ step: 'scholarship', step_index: 7 })

    const scholarshipShared = { ...packageShared, _scholarshipShared: true }
    expect(agentTools.deriveStep({ collected: scholarshipShared })).toEqual({ step: 'location', step_index: 8 })

    const withLocation = { ...scholarshipShared, location: 'Kakinada' }
    expect(agentTools.deriveStep({ collected: withLocation })).toEqual({ step: 'transport', step_index: 9 })

    const withTransport = { ...withLocation, transport_need: 'hostel' }
    expect(agentTools.deriveStep({ collected: withTransport })).toEqual({ step: 'queries', step_index: 10 })

    const withVisit = { ...withTransport, visit_appointment: 'Saturday at 11 AM' }
    expect(agentTools.deriveStep({ collected: withVisit })).toEqual({ step: 'end', step_index: 11 })
  })

  it('forces end (11) when _escalate or _endCall is set, regardless of progress', () => {
    expect(agentTools.deriveStep({ collected: { _escalate: true } })).toEqual({ step: 'end', step_index: 11 })
    expect(agentTools.deriveStep({ collected: { _endCall: true } })).toEqual({ step: 'end', step_index: 11 })
  })
})

describe('agentTools — executeTool', () => {
  beforeEach(() => jest.clearAllMocks())

  it('save_detail validates and returns a collected patch on success', async () => {
    const { result, collectedPatch } = await agentTools.executeTool('s1', 'save_detail', { field: 'marks_10', value: '85' }, {})
    expect(collectedPatch).toEqual({ marks_10: '85%' })
    expect(result).toMatch(/Saved marks_10/)
  })

  it('save_detail returns an error and no patch on invalid input', async () => {
    const { result, collectedPatch } = await agentTools.executeTool('s1', 'save_detail', { field: 'marks_10', value: '150' }, {})
    expect(collectedPatch).toEqual({})
    expect(result).toMatch(/Error/)
  })

  it('get_course_package queries vectorStore and sets _packageShared', async () => {
    const { result, collectedPatch } = await agentTools.executeTool('s1', 'get_course_package', { course: 'B.Tech', department: 'CSE' }, {})
    expect(vectorStore.search).toHaveBeenCalled()
    expect(collectedPatch).toEqual({ _packageShared: true })
    expect(result).toMatch(/Fee facts/)
  })

  it('book_campus_visit requires both day and time', async () => {
    const missing = await agentTools.executeTool('s1', 'book_campus_visit', { day: 'Saturday' }, {})
    expect(missing.collectedPatch).toEqual({})
    expect(missing.result).toMatch(/Error/)

    const ok = await agentTools.executeTool('s1', 'book_campus_visit', { day: 'Saturday', time: '11 AM' }, {})
    expect(ok.collectedPatch).toEqual({ visit_appointment: 'Saturday at 11 AM' })
  })

  it('end_call and escalate_to_human set their respective flags', async () => {
    const end = await agentTools.executeTool('s1', 'end_call', { reason: 'done' }, {})
    expect(end.collectedPatch).toEqual({ _endCall: true })

    const escalate = await agentTools.executeTool('s1', 'escalate_to_human', { reason: 'angry caller' }, {})
    expect(escalate.collectedPatch).toEqual({ _escalate: true })
  })
})
