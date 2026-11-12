// A small bundle that uses every level: a service, two journeys, and a questionnaire with pages,
// a conditional question and a branch. The studio starts from it.
export const EXAMPLE_BUNDLE = `# Service → Journey → Questionnaire, in one file. Documents are separated by --- lines.
kind: service
id: clinic
title: Clinic visit
summary: Check in and get ready for your appointment.
icon: clipboard-list
order: 10
items:
  - { key: check-in, label: Check in for your visit, icon: clipboard-list, journey: visit-check-in }
  - { key: feedback, label: Tell us how it went, icon: message-circle, journey: quick-feedback }
---
kind: service
id: help
title: Help
summary: Other things the kiosk can do.
icon: wrench
order: 20
items:
  - { key: ask, label: Ask a question, icon: message-square, screen: transcript }
---
kind: journey
id: visit-check-in
version: 1
title: Check in for your visit
summary: A few questions before you see the nurse. Your answers stay on this device.
icon: clipboard-list
start: intake
steps:
  intake:
    label: Your visit
    questionnaire: visit-intake
    submitLabel: Check in
    next:
      - { if: "answers.intake.severity == 'severe'", to: urgent }
      - { to: done }
  urgent:
    final: true
    result:
      title: "Please tell a member of staff now"
      text: "{{answers.intake.name}}, you said it is severe. Please go to the desk straight away."
      ok: true
  done:
    final: true
    result:
      title: "Checked in: {{answers.intake.name}}"
      text: "Main problem: {{answers.intake.symptom}}\\nFor {{answers.intake.days}} days\\nFever: {{answers.intake.fever}}\\nTemperature: {{answers.intake.temperature}}\\n\\nShow this to the staff at the desk."
---
kind: questionnaire
id: visit-intake
version: 1
title: Visit intake
summary: Tell us about yourself and what brings you in.
sections:
  - id: about-you
    title: About you
    fields:
      - { id: name, type: text, label: Your name, required: true, entity: person }
      - { id: city, type: text, label: City, entity: location }
      - { id: language, type: language, label: Language you prefer }
  - id: symptoms
    title: What brings you in
    summary: Answer what you can.
    fields:
      - { id: symptom, type: textarea, label: Main problem, required: true, description: "Such as pain, cough or fever" }
      - { id: days, type: number, label: How many days }
      - id: severity
        type: select
        label: How bad is it
        required: true
        options:
          - { value: mild, label: Mild }
          - { value: moderate, label: Moderate }
          - { value: severe, label: Severe }
      - { id: fever, type: boolean, label: I have a fever }
      - { id: temperature, type: number, label: Temperature, when: "values.fever == true", description: "If you measured it" }
---
kind: journey
id: quick-feedback
version: 1
title: Tell us how it went
summary: Two questions; the assistant writes a short thank-you.
icon: message-circle
start: ask
steps:
  ask:
    label: Your feedback
    ask: How was your visit today?
    fields:
      - id: rating
        type: select
        label: Overall
        required: true
        options:
          - { value: good, label: Good }
          - { value: fine, label: Fine }
          - { value: bad, label: Bad }
      - { id: comment, type: textarea, label: Anything else? }
    next: thank
  thank:
    label: Thank you note
    service: agent.ask
    with:
      message: "Write one friendly sentence thanking a visitor who rated their visit {{answers.ask.rating}}."
    onError: continue
    next: done
  done:
    final: true
    result:
      title: Thank you
      text: "{{steps.thank.text}}"
`;
