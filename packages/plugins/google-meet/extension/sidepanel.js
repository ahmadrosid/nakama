/* global chrome */

const chrome = globalThis.chrome;
const status = document.querySelector("#status");
const transcript = document.querySelector("#transcript");
let cursor = 0;
let meetingId;
let running = false;
const turnIds = new Set();

async function refresh() {
  if (running) {
    return;
  }
  running = true;
  try {
    const result = await chrome.runtime.sendMessage({
      after: cursor,
      type: "TRANSCRIPT",
    });
    if (!result) {
      status.textContent = "Open Nakama and connect a Google Meet tab.";
      return;
    }
    if (meetingId !== result.meeting.id) {
      meetingId = result.meeting.id;
      cursor = 0;
      turnIds.clear();
      transcript.replaceChildren();
    }
    for (const segment of result.segments) {
      if (transcript.firstElementChild?.id === "empty") {
        transcript.firstElementChild.remove();
      }
      if (turnIds.has(segment.id)) {
        continue;
      }
      turnIds.add(segment.id);
      const turn = document.createElement("p");
      const speaker = document.createElement("strong");
      speaker.textContent = segment.speakerName || "Unknown speaker";
      turn.append(speaker, document.createTextNode(segment.text));
      transcript.append(turn);
    }
    cursor = result.nextCursor;
    status.textContent =
      result.meeting.state === "finished"
        ? "Transcript ready"
        : "Live transcript";
    if (!(transcript.firstElementChild || result.segments.length)) {
      const empty = document.createElement("p");
      empty.id = "empty";
      empty.textContent = "Waiting for the first transcript…";
      transcript.append(empty);
    }
  } catch (error) {
    status.textContent = error.message;
  } finally {
    running = false;
  }
}

const timer = setInterval(() => void refresh(), 2000);
window.addEventListener("pagehide", () => clearInterval(timer));
void refresh();
