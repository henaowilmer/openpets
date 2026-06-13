import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { shouldShowDefaultPetForExternalEvent } from "../src/app-state-core.js";

assert.equal(
  shouldShowDefaultPetForExternalEvent(false, false, false),
  true,
  "external pet.say should show the default pet even when launch display is disabled",
);
assert.equal(
  shouldShowDefaultPetForExternalEvent(true, false, false),
  true,
  "external events should keep showing an already visible default pet",
);
assert.equal(
  shouldShowDefaultPetForExternalEvent(false, true, false),
  true,
  "external events should keep showing the default pet when launch display is enabled",
);
assert.equal(
  shouldShowDefaultPetForExternalEvent(false, false, true),
  false,
  "paused state should suppress external default pet display",
);
assert.equal(
  shouldShowDefaultPetForExternalEvent(true, true, true),
  false,
  "paused state should suppress external default pet display even when the window is visible",
);

const appRoot = process.env.OPENPETS_DESKTOP_ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const controllerSource = readFileSync(join(appRoot, "src", "default-pet-controller.ts"), "utf8");
const showDefaultPet = extractFunction(controllerSource, "showDefaultPet");
const showDefaultPetWindow = extractFunction(controllerSource, "showDefaultPetWindow");
const showDefaultPetForExternalEvent = extractFunction(controllerSource, "showDefaultPetForExternalEvent");
const applyExternalPetSay = extractFunction(controllerSource, "applyExternalPetSay");
const getOrCreateDefaultPetWindow = extractFunction(controllerSource, "getOrCreateDefaultPetWindow");

assert.match(
  showDefaultPet,
  /updatePreferences\(\{ openDefaultPetOnLaunch: true \}\);[\s\S]*showDefaultPetWindow\("user"\);/,
  "explicit user show should still persist the open-on-launch preference",
);
assert.doesNotMatch(
  showDefaultPetWindow,
  /updatePreferences/,
  "shared window show path must not persist the open-on-launch preference",
);
assert.match(showDefaultPetWindow, /getOrCreateDefaultPetWindow\(\)/, "shared window show path should create the window when needed");
assert.match(showDefaultPetWindow, /window\.showInactive\(\)/, "shared window show path should make the pet visible");
assert.match(
  showDefaultPetForExternalEvent,
  /shouldShowDefaultPetForExternalEvent\(visible, state\.preferences\.openDefaultPetOnLaunch, paused\)/,
  "external show should use the pure decision helper",
);
assert.match(
  showDefaultPetForExternalEvent,
  /showDefaultPetWindow\("external-event"\)/,
  "external show should open the default pet without going through the preference-writing user action",
);
assert.doesNotMatch(
  showDefaultPetForExternalEvent,
  /showDefaultPet\(\)/,
  "external show must not call the preference-writing user action",
);
assert.match(
  applyExternalPetSay,
  /setTransientDisplay\(\{ message, reaction \}\);\s*showDefaultPetForExternalEvent\(\);/,
  "pet.say should set the transient message before opening the default pet window",
);
assert.match(
  getOrCreateDefaultPetWindow,
  /display: transientDisplay/,
  "new default pet windows should render the active transient message on first load",
);

console.error("Default pet external show validation passed.");

function extractFunction(source: string, functionName: string): string {
  const declaration = `function ${functionName}`;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `missing function ${functionName}`);

  const bodyStart = source.indexOf("{\n", start);
  assert.notEqual(bodyStart, -1, `missing body for ${functionName}`);

  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  assert.fail(`unterminated function ${functionName}`);
}
