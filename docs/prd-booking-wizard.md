# PRD — Multi-Step Booking Wizard

> Sample PRD used as input to `workflows/afk-pipeline.workflow.ts`.
> Replace this with your own real PRD (Phase 1, HITL) before running the pipeline for real.

## Goal

Let a guest book a room in a single, resumable three-step wizard without losing
progress between steps.

## User

A logged-out guest on a hotel marketing site who clicks "Book now".

## Happy path

1. **Step 1 — Guest info.** Name, email, phone. Persists a draft booking.
2. **Step 2 — Room selection.** Choose room type and dates from availability.
3. **Step 3 — Payment.** Card details, confirm, see a confirmation number.

## Edge cases & validation

- Email and phone are validated client- and server-side.
- Room availability is re-checked at confirmation time (it can change between steps).
- A declined card returns the user to step 3 with the entered (non-card) data intact.
- Navigating back never loses already-entered data.

## Error states

- Network failure on any step shows a retryable inline error, not a dead end.
- Server validation errors map to the specific field.

## Out of scope

- Authentication / guest accounts.
- Multi-room and group bookings.
- Loyalty points and discount codes.

## Suggested vertical slices

The slicer agent should land on roughly these (UI + API + e2e test each):

- `step-1-guest-info` — form + `POST /booking/draft`
- `step-2-room-selection` — form + `GET /rooms`
- `step-3-payment` — form + `POST /booking/confirm`
- `wizard-state-machine` — cross-step navigation + persistence
