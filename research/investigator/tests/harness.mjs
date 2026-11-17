// The investigator's test runner: no dependencies, like the extension's tests/load.mjs.
// A case returns true to pass, or a string saying what went wrong.
export async function run(cases) {
  let passed = 0;
  for (const [label, fn] of cases) {
    try {
      const result = await fn();
      if (result === true) passed++;
      else console.log(`FAIL ${label}: ${result}`);
    } catch (e) {
      console.log(`FAIL ${label}: threw ${(e && e.stack) || e}`);
    }
  }
  console.log(`${passed}/${cases.length} pass`);
  if (passed !== cases.length) process.exit(1);
}
