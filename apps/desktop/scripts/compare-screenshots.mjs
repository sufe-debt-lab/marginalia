#!/usr/bin/env node

export function parseCompareArgs(argv) {
  const options = {
    mode: "regression",
    design: null,
    impl: null,
    updateBaseline: [],
    reason: null,
    failOnDiff: false,
    maxDiffPercent: null
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (
      arg === "--design" ||
      arg === "--impl" ||
      arg === "--reason" ||
      arg === "--max-diff-percent"
    ) {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      if (arg === "--design") options.design = value;
      else if (arg === "--impl") options.impl = value;
      else if (arg === "--reason") options.reason = value;
      else {
        const num = Number(value);
        if (!Number.isFinite(num) || num < 0) {
          throw new Error(`--max-diff-percent requires a non-negative number, got: ${value}`);
        }
        options.maxDiffPercent = num;
      }
      i += 1;
    } else if (arg === "--update-baseline") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) {
        options.updateBaseline.push(argv[i + 1]);
        i += 1;
      }
      if (options.updateBaseline.length === 0)
        throw new Error("--update-baseline requires selectors");
    } else if (arg === "--fail-on-diff") {
      options.failOnDiff = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  if (options.updateBaseline.length > 0 && !options.reason) {
    throw new Error('--update-baseline requires --reason "<why>"');
  }
  if ((options.design === null) !== (options.impl === null)) {
    throw new Error(options.design ? "--design requires --impl" : "--impl requires --design");
  }
  if (options.design) options.mode = "design";
  return options;
}

export function classifyShots({ manifest, scenarios, baselineLabels }) {
  const ranScenarios = (manifest.scenarios ?? []).filter(
    (id) => scenarios[id] && !scenarios[id].live
  );
  const entries = [];
  for (const id of ranScenarios) {
    const shots = (manifest.screenshots ?? []).filter((shot) => shot.scenario === id);
    const captured = new Set(shots.map((shot) => shot.label));
    for (const shot of shots) {
      const hasBaseline = (baselineLabels[id] ?? []).includes(shot.label);
      entries.push({
        scenario: id,
        label: shot.label,
        path: shot.path,
        status: hasBaseline ? "pending-diff" : "new"
      });
    }
    for (const label of baselineLabels[id] ?? []) {
      if (!captured.has(label)) entries.push({ scenario: id, label, status: "orphan" });
    }
  }
  const notCovered = Object.keys(baselineLabels)
    .filter((id) => !ranScenarios.includes(id))
    .sort();
  return { entries, notCovered };
}
