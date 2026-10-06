'use strict';

/**
 * What the shell should write when its window closes before finish() ran.
 *
 * `--keep-open` / `--show` runs are ended by the human closing the window;
 * that is success even when the automated DOM/capture probe had not finished
 * yet (a heavy plugin such as dsh-orb can take longer than the human wants to
 * wait). A hidden automated run closing early is a crash and must stay a
 * failure so a renderer crash is never reported as green.
 */
function earlyCloseOutcome({ keepOpen = false, show = false, probePayload = null } = {}) {
  if (probePayload && typeof probePayload === 'object') {
    return { ok: true, extra: { ...probePayload, closedByUser: true } };
  }
  if (keepOpen === true || show === true) {
    return { ok: true, extra: { closedByUser: true, probeIncomplete: true } };
  }
  return { ok: false, extra: { error: 'shell window closed before the probe completed' } };
}

module.exports = { earlyCloseOutcome };
