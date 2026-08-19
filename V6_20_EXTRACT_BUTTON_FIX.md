# V6.20 — Extract CV Button Fix

Based directly on V6.19. Authentication, bulk upload, R2 and D1 are unchanged.

The V6.19 Extract CV handler referenced `#screenResult`, but the actual HTML
uses `#result` and `#resultText`. This caused the click handler to fail before
the extraction request/result could be shown.

V6.20:
- uses the real `#result` / `#resultText` elements;
- unhides the Screening result card on click;
- sends the JSON Content-Type header;
- displays extraction errors in the result panel;
- makes Extract CV an explicit non-submit button.

No schema/migration changes.
