# Sequential review

Pin the review at the starting commit Striker supplied. Include committed,
staged, unstaged, and untracked task changes while excluding the preserved dirty
baseline.

## Standards pass

Read every repository rule that governs a changed path. Review only changes
since the pinned commit. Find mandatory rule breaches and concrete defects,
including dependency direction, duplicate authorities, global state, file and
function limits, complexity, and implicit fallback. Fix all blocking findings.

## Plan compliance pass

Start only after the standards pass and its fixes are green. Compare the same
change against the supplied task Build, Paths, Test contract, and Verify
sections plus the plan's out-of-scope boundary. Find missing requirements,
partial behavior, changed public contracts, and work pulled from later tasks.
Fix all confirmed findings.

After either pass changes code, rerun the focused checks it affects. Finish by
running the repository green command and the task's relevant verification.
