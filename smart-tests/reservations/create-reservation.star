# Captures the reservation contract so Smart Diff can compare a sandbox against
# the baseline. The checks cover what a diff cannot: that the response still
# carries the fields a caller depends on.

payload = {
    "showId": "show-1",
    "seats": ["B11", "B12"],
    "currency": "USD",
    "idempotencyKey": "smart-reservation",
}

res = http.post(
    url = "http://storefront.boxoffice.svc:8080/reservations",
    json_body = payload,
    capture = True,  # enables Smart Diff
    name = "createReservation",
)

ck = smart_test.check("reservation-created")
if res.status_code != 201:
    ck.error("expected HTTP 201, got {}", res.status_code)

body = res.json()
if type(body) == "dict":
    ck_fields = smart_test.check("reservation-fields-present")
    for field in ["reservationId", "status", "seats", "expiresAt", "quote"]:
        if field not in body:
            ck_fields.error("the reservation is missing {}", field)

    if "quote" in body and type(body["quote"]) == "dict":
        ck_fees = smart_test.check("quote-carries-fees")
        if "fees" not in body["quote"]:
            ck_fees.error("the quote no longer carries fees, so the total understates the price")
