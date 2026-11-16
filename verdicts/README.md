# Human Music verdicts

The list Human Music's investigator writes: artists checked for being
AI-generated, each with a verdict (`ai`, `human` or `unsure`) and a
confidence from 0 to 100. Human Music downloads it from this repo; its
filtering mode decides which confidence blocks (Optimal: AI at 95 or more,
Aggressive: 60 or more).

`calibrated` turns true once the confidences have been checked against
artists known to be AI-generated and artists known to be people.
