const $ = (id) => document.getElementById(id);
let orgId;
let workflows = [];
let selected = null;
let steps = [];
let busy = false;
let selectionRevision = 0;
const showError = (error) => {
  $("error").textContent = error?.message ?? String(error ?? "");
  $("error").hidden = !error;
};
async function action(key, input = {}) {
  const csrf =
    document.cookie
      .split("; ")
      .find((cookie) => cookie.startsWith("nakama_csrf="))
      ?.slice(12) ?? "";
  const response = await fetch(`/v1/plugins/workflows/actions/${key}`, {
    body: JSON.stringify({ input }),
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": decodeURIComponent(csrf),
      "X-Org-Id": orgId,
    },
    method: "POST",
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Action failed.");
  }
  return data.result;
}
async function perform(work) {
  if (busy) {
    return;
  }
  busy = true;
  showError(null);
  for (const element of document.querySelectorAll(
    "button,input,select,textarea"
  )) {
    element.disabled = true;
  }
  try {
    await work();
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    for (const element of document.querySelectorAll(
      "button,input,select,textarea"
    )) {
      element.disabled = false;
    }
    $("run").disabled = !selected;
    $("delete").disabled = !selected;
  }
}
function text(tag, content) {
  const element = document.createElement(tag);
  element.textContent = content;
  return element;
}
function renderList() {
  $("list").replaceChildren();
  for (const workflow of workflows) {
    const button = text("button", workflow.name);
    button.type = "button";
    button.setAttribute("aria-current", String(workflow.id === selected?.id));
    button.addEventListener("click", () => {
      if (!busy) {
        select(workflow);
      }
    });
    $("list").append(button);
  }
  if (!workflows.length) {
    $("list").append(text("p", "No workflows yet"));
  }
}
function select(workflow) {
  selected = workflow;
  selectionRevision++;
  $("editor").hidden = false;
  $("empty").hidden = true;
  $("name").value = workflow?.name ?? "";
  $("description").value = workflow?.description ?? "";
  if (workflow) {
    $("agent").value = workflow.profileId;
  }
  $("enabled").checked = workflow?.enabled ?? true;
  $("summary").value =
    workflow?.steps.find((step) => step.kind === "summarize")?.prompt ??
    "Summarize only the step results.";
  steps = structuredClone(
    workflow?.steps.filter((step) => step.kind !== "summarize") ?? []
  );
  $("run").disabled = !workflow;
  $("delete").disabled = !workflow;
  $("history").replaceChildren();
  renderList();
  renderSteps();
  if (workflow) {
    void loadRuns(workflow.id, selectionRevision).catch(showError);
  }
}
function field(container, label, value, update, choices) {
  const wrapper = text("label", label);
  const input = document.createElement(choices ? "select" : "input");
  if (choices) {
    for (const choice of choices) {
      const option = text("option", choice);
      option.value = choice;
      input.append(option);
    }
  }
  input.value = value ?? "";
  input.addEventListener("change", () => update(input.value));
  wrapper.append(input);
  container.append(wrapper);
}
function renderSteps() {
  $("steps").replaceChildren();
  steps.forEach((step, index) => {
    const section = document.createElement("fieldset");
    section.append(text("legend", `Step ${index + 1}`));
    field(section, "Step ID", step.id, (value) => {
      step.id = value;
    });
    field(
      section,
      "Kind",
      step.kind,
      (kind) => {
        steps[index] = {
          id: step.id,
          kind,
          ...(kind === "compare" ? { left: "", op: "eq", right: "" } : {}),
        };
        renderSteps();
      },
      ["tool", "compare", "assert", "template"]
    );
    const fields = {
      assert: ["path", "expected"],
      compare: ["left", "op", "right", "tolerance"],
      template: ["template"],
      tool: ["tool", "input"],
    }[step.kind];
    for (const key of fields) {
      const value =
        typeof step[key] === "object" ? JSON.stringify(step[key]) : step[key];
      field(
        section,
        key === "input"
          ? "Tool arguments (JSON)"
          : key.charAt(0).toUpperCase() + key.slice(1),
        value,
        (value) => {
          if (key === "input") {
            try {
              step[key] = JSON.parse(value || "{}");
              showError(null);
            } catch {
              step[key] = value;
              showError(new Error("Tool arguments must be valid JSON."));
            }
          } else if (["left", "right", "expected", "tolerance"].includes(key)) {
            if (!value && key === "tolerance") {
              delete step[key];
            } else {
              try {
                step[key] = JSON.parse(value);
              } catch {
                step[key] = value;
              }
            }
          } else {
            step[key] = value;
          }
        },
        key === "op" ? ["eq", "near", "contains"] : undefined
      );
    }
    const buttons = document.createElement("div");
    buttons.className = "buttons";
    for (const [label, delta] of [
      ["Move up", -1],
      ["Move down", 1],
      ["Remove", 0],
    ]) {
      const button = text("button", label);
      button.type = "button";
      button.addEventListener("click", () => {
        if (delta === 0) {
          steps.splice(index, 1);
        } else if (index + delta >= 0 && index + delta < steps.length) {
          [steps[index], steps[index + delta]] = [
            steps[index + delta],
            steps[index],
          ];
        }
        renderSteps();
      });
      buttons.append(button);
    }
    section.append(buttons);
    $("steps").append(section);
  });
}
async function refresh(id) {
  workflows = await action("list_workflows");
  select(
    workflows.find((workflow) => workflow.id === id) ?? workflows[0] ?? null
  );
}
async function loadRuns(id, revision) {
  const runs = await action("runs", { workflowId: id });
  if (revision !== selectionRevision) {
    return;
  }
  $("history").replaceChildren(text("h2", "Run history"));
  for (const run of runs) {
    const details = document.createElement("details");
    details.append(
      text(
        "summary",
        `${run.status} · ${new Date(run.startedAt).toLocaleString()}`
      )
    );
    if (run.error || run.output) {
      details.append(text("pre", run.error || run.output));
    }
    for (const step of run.steps ?? []) {
      details.append(text("h3", `${step.stepId} · ${step.status}`));
      details.append(
        text(
          "pre",
          JSON.stringify(
            { error: step.error, input: step.input, output: step.output },
            null,
            2
          )
        )
      );
    }
    $("history").append(details);
  }
}
$("new").addEventListener("click", () => select(null));
$("add").addEventListener("click", () => {
  steps.push({
    id: `step_${crypto.randomUUID().slice(0, 8)}`,
    input: {},
    kind: "tool",
    tool: "web_fetch",
  });
  renderSteps();
});
$("editor").addEventListener("submit", (event) => {
  event.preventDefault();
  void perform(async () => {
    const input = {
      agentId: $("agent").value,
      description: $("description").value,
      enabled: $("enabled").checked,
      name: $("name").value,
      steps: [
        ...steps,
        {
          id:
            selected?.steps.find((step) => step.kind === "summarize")?.id ??
            "summary",
          kind: "summarize",
          prompt: $("summary").value,
        },
      ],
    };
    if (selected) {
      input.workflowId = selected.id;
    }
    const workflow = await action(
      selected ? "update_workflow" : "create_workflow",
      input
    );
    await refresh(workflow.id);
  });
});
$("run").addEventListener(
  "click",
  () =>
    void perform(async () => {
      const id = selected.id;
      $("history").replaceChildren(text("p", "Running…"));
      const input = JSON.parse($("input").value || "{}");
      const result = await action("run_workflow", { input, workflowId: id });
      await loadRuns(id, selectionRevision);
      if (result.error) {
        throw new Error(result.error);
      }
    })
);
$("delete").addEventListener("click", () => $("confirm").showModal());
$("confirm").addEventListener("close", () => {
  if ($("confirm").returnValue === "delete") {
    void perform(async () => {
      await action("delete_workflow", { workflowId: selected.id });
      await refresh();
    });
  }
});
try {
  const theme = new URLSearchParams(location.search).get("theme") ?? "system";
  const response = await fetch(
    `__nakama/bootstrap.json?theme=${encodeURIComponent(theme)}`
  );
  if (!response.ok) {
    throw new Error("Plugin is unavailable.");
  }
  const bootstrap = await response.json();
  orgId = bootstrap.orgId;
  document.documentElement.dataset.theme =
    theme === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;
  parent.postMessage(
    { pluginId: "workflows", type: "nakama-plugin-ready" },
    location.origin
  );
  const profiles = await action("profiles");
  for (const profile of profiles) {
    const option = text("option", profile.name);
    option.value = profile.id;
    option.selected = profile.isDefault;
    $("agent").append(option);
  }
  await refresh();
} catch (error) {
  showError(error);
  $("list").textContent = "Unavailable";
}

async function loadDatabase(table) {
  const data = await action("database", table ? { table } : {});
  if (!table) {
    $("table").replaceChildren(text("option", "Select a table"));
    $("table").firstChild.value = "";
    for (const item of data.tables) {
      const option = text("option", item.name);
      option.value = item.name;
      $("table").append(option);
    }
  }
  $("database").replaceChildren();
  if (data.preview) {
    $("database").append(text("pre", JSON.stringify(data.preview, null, 2)));
  }
}
$("database-panel").addEventListener("toggle", () => {
  if ($("database-panel").open) {
    void loadDatabase().catch(showError);
  }
});
$("table").addEventListener(
  "change",
  () => void loadDatabase($("table").value).catch(showError)
);
