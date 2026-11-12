# 04 Languages and voice

| ID | Requirement | Status |
|---|---|---|
| LNG-1 | The kiosk must offer 14 languages: English, Hindi, Tamil, Kannada, Telugu, Malayalam, Bengali, French, Spanish, German, Portuguese, Arabic, Chinese (Simplified) and Japanese. Each is shown in its own script with its English name ("தமிழ் · Tamil"). | Built |
| LNG-2 | The visitor must be able to pick the language from the kiosk's header at any time, and in Settings → Language. A profile may set it (06). | Built |
| LNG-3 | The chosen language must drive speech recognition, the read-aloud voice, the agent's reply language and on-device translation of on-device answers. | Built |
| LNG-4 | The agent must reply in the chosen language whatever language its sources are in, and keep the sources line exactly as `(sources: …)` with ids untranslated. | Built |
| LNG-5 | An on-device answer in another language must be translated on the device and say so ("Translated on this device from English"); if translation fails, it must be shown in English with a note. | Built |
| LNG-6 | Read-aloud must use a voice for the chosen language. When none is installed, Settings must say so and explain how to add one (system language settings, or Microsoft Edge's online voices). | Built |
| LNG-7 | Speech recognition and some voices are provided by the browser and may be processed online by its maker; Settings should say so. | Planned |
| LNG-8 | The kiosk's own screens (buttons, labels, messages) should be shown in the chosen language. | Planned |

## Voice

| ID | Requirement | Status |
|---|---|---|
| VOI-1 | The microphone must start and stop with one tap, show what it hears while listening, and send the question when the visitor stops speaking. | Built |
| VOI-2 | Read-aloud must be switchable, with pause, resume and stop, a choice of voice and a speaking rate. | Built |
| VOI-3 | A form question (05) must accept speech as well as typing. | Built |
