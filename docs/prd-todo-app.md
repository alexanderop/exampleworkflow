# PRD — Personal Todo App

> Sample PRD used as input to `workflows/afk-pipeline.workflow.ts`.
> Replace this with your own real PRD (Phase 1, HITL) before running the pipeline for real.
>
> A PRD describes **what** to build and **why** — the user, the happy path, the
> rules, the boundaries. It never says **how** to slice the work: that is the
> slicer agent's job in Phase 2. Don't list tasks, components, endpoints, or
> "suggested slices" here.

## Goal

Let a registered user keep a private todo list: log in, add todos, and delete
them. Each user sees only their own todos, and the list survives a page reload
and a new session.

## User

A returning individual who has registered with an email and password. There is
no anonymous/guest mode — the todo list is only reachable once logged in.

## Happy path

1. **Register.** A new visitor signs up with an email and a password and lands
   on their (empty) todo list.
2. **Log in.** A returning visitor enters their email and password and lands on
   their todo list, populated with the todos they added previously.
3. **Add a todo.** From the list, the user types a todo's text and adds it; it
   appears in the list immediately and is persisted.
4. **Delete a todo.** The user removes a todo from the list; it disappears
   immediately and stays gone after reload.
5. **Log out.** The user ends their session and is returned to the login screen.

## Edge cases & validation

- Email must be a well-formed, unique address; password must meet a minimum
  length. Both are validated client- and server-side.
- Registering with an email that already exists is rejected with a clear message
  rather than creating a duplicate account or overwriting the existing one.
- Passwords are never stored in plaintext or returned to the client.
- A todo's text is required and trimmed; empty or whitespace-only todos are
  rejected. Overly long text is rejected with a clear limit.
- A user can only see, add to, and delete from their own list — never another
  user's. Deleting a todo that isn't yours (or doesn't exist) is rejected, not
  silently applied.

## Error states

- Wrong email/password on login shows a single generic "invalid credentials"
  error (it does not reveal whether the email exists).
- A network or server failure on any action shows a retryable inline error and
  leaves the user's entered data intact — never a dead end.
- Server validation errors map back to the specific field that caused them.
- Visiting the todo list while logged out redirects to login, not an error page.

## Technical constraints

- Built with **Nuxt 4**.
- **SQLite** is the persistence layer for both users and todos.
- These pin the stack only. Architecture, schema, routes, and how the work is
  sliced are decided downstream — not here.

## Out of scope

- Editing a todo's text, marking it complete, reordering, or due dates.
- Sharing lists, collaboration, or any multi-user/team features.
- Password reset, email verification, OAuth / social login, and "remember me".
- Categories, tags, search, and filtering.
