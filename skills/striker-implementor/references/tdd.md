# Test-first implementation

The task's Test contract names the approved seams. Test through those public
boundaries, using real temporary files and repositories where the contract asks
for them. Fake only the external agent runtime.

For each behavior:

1. Add one test that fails for the missing behavior.
2. Run that focused test and confirm the failure is relevant.
3. Add the smallest production change that passes it.
4. Run the focused test again before starting the next behavior.

Expected values come from the task contract or a worked literal, not from
repeating the production algorithm in the assertion. Tests describe observable
behavior and remain valid when internal structure changes.

Refactoring begins after the behavior cycles are green. Keep it separate from
the red-green loop so a failing test has one cause.
