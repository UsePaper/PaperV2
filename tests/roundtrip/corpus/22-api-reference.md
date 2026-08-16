# API

All calls return JSON and use the `application/json` content type.

## `GET /widgets`

Lists every widget.

Query parameters:

- `limit` is the number of widgets to return, at most 100
- `cursor` is the value of `next` from a previous response
- `order` is either `created` or `name`

```json
{
  "widgets": [],
  "next": null
}
```

## `POST /widgets`

Creates a widget. The body must hold a `name`, and may hold a `colour`.

Returns `201` with the new widget, or `422` when the name is already taken.

## `DELETE /widgets/{id}`

Removes a widget. Returns `204` on success and `404` when the widget is unknown.

## Errors

Every error carries a `code` and a human readable `message`. Do not match on the message: it changes. Match on the [error code](https://example.com/docs/errors).
