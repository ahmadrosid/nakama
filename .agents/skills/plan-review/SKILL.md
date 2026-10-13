---
name: plan-review
description: Review an implementation plan for major gaps, then revise the plan until no major issue remains. Use when asked to stress-test or improve a plan.
---

# Review and revise an implementation plan

Review the plan against its issue, project rules, and current code. Fix major gaps in the plan itself. Continue until another evidence-based review finds no major issue.

## Workflow

1. Find the plan and read it. Read the referenced issue or specification and applicable project instructions.
2. Check claims about current code against the repository. Use the codebase graph tools first when available. Read source only to verify relevant details.
3. Look for major gaps in scope, feasibility, data flow, security, compatibility, failure handling, acceptance checks, tests, and required gates. Treat a gap as major when it can block delivery, break existing behavior, expose or lose data, or make success hard to verify.
4. Revise the plan to fix verified gaps. Use the existing design and code where possible. State any unresolved decision or assumption clearly.
5. Review the revised plan again against the same sources. Repeat until no major issue remains, or until a decision needs user input.
6. Check the final file for consistency and whitespace. Do not implement the plan or change external systems unless the user asks.

## Rules

- Keep the user's goal and scope. Do not turn a review into a redesign or add optional features.
- Separate verified facts from proposed design choices. Do not present a proposal as current project behavior.
- Check whether proposed contracts fit real callers, schemas, transports, and data paths.
- Include concrete acceptance checks and focused tests for risky or changed behavior.
- Treat missing labels, assignments, approvals, or other project gates as planning constraints. Do not use them to stop plan review.
- Ask the user only when a material choice cannot be resolved from the plan, issue, project rules, or code. Continue other review work first.
- Finish with the plan path, the major gaps fixed, and any remaining unverified decisions or checks.
