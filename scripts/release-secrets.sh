#!/usr/bin/env bash
#
# Turns a downloaded Developer ID certificate plus the key asc generated into a
# .p12, and sets the six GitHub secrets that .github/workflows/release.yml reads.
#
# Nothing secret is printed. The .p12 password is generated here, used once, and
# piped straight into `gh secret set`; it is never displayed and never stored,
# because nothing ever needs to read it again.
#
# Run it after the two manual steps: the certificate and the API key.

set -euo pipefail

REPO="UsePaper/PaperV2"
DIR="$HOME/.private/paperv2"
KEY="$DIR/dev-id.key"

cd "$DIR"

# --- locate the inputs -------------------------------------------------------

CER=$(find "$DIR" -maxdepth 1 -name "*.cer" -print -quit)
if [[ -z "$CER" ]]; then
  echo "No .cer here. Download the certificate from the portal into $DIR first." >&2
  exit 1
fi

P8=$(find "$DIR" -maxdepth 1 -name "AuthKey_*.p8" -print -quit)
if [[ -z "$P8" ]]; then
  echo "No AuthKey_*.p8 here. Run the asc web api-keys create step first." >&2
  exit 1
fi

if [[ ! -f "$KEY" ]]; then
  echo "Missing $KEY — the private key that matches the CSR. Without it the" >&2
  echo "certificate is unusable and has to be reissued from a new CSR." >&2
  exit 1
fi

# --- build the .p12 ----------------------------------------------------------

openssl x509 -inform DER -in "$CER" -out dev-id.pem

# The certificate has to match the key, or CI fails with an error that does not
# say so. Compare the public keys rather than finding out in a release build.
if [[ "$(openssl x509 -in dev-id.pem -noout -pubkey)" \
   != "$(openssl rsa -in "$KEY" -pubout 2>/dev/null)" ]]; then
  echo "The certificate does not match dev-id.key. Wrong .cer, or the CSR was" >&2
  echo "regenerated after the certificate was issued." >&2
  exit 1
fi

PASSWORD=$(openssl rand -base64 24)

# A Keychain Access export carries the issuing intermediate with it; one built
# from a bare .cer does not, and codesign needs the chain to reach a trusted
# root. The runner usually has this certificate already, via Xcode, but
# "usually" is not a thing to discover halfway through a release.
curl -sfL -o DeveloperIDG2CA.cer \
  https://www.apple.com/certificateauthority/DeveloperIDG2CA.cer
openssl x509 -inform DER -in DeveloperIDG2CA.cer -out intermediate.pem

# -legacy is required. OpenSSL 3 defaults to AES-256, and the `security import`
# that tauri-action runs on the macOS runner cannot read that; the failure shows
# up as an unhelpful "MAC verification failed" in the middle of a release.
openssl pkcs12 -export \
  -in dev-id.pem \
  -inkey "$KEY" \
  -certfile intermediate.pem \
  -out dev-id.p12 \
  -name "Developer ID Application" \
  -legacy \
  -passout pass:"$PASSWORD"

chmod 600 dev-id.p12

# The signing identity is the certificate's own common name. Reading it from the
# certificate avoids a typo that would only surface in CI.
IDENTITY=$(openssl x509 -in dev-id.pem -noout -subject -nameopt multiline \
  | awk -F' = ' '/commonName/ {print $2}')

echo "Signing identity: $IDENTITY"
echo

# --- set the secrets ---------------------------------------------------------

KEY_ID=$(basename "$P8" .p8 | sed 's/^AuthKey_//')
ISSUER=$(asc auth issuer-id)

base64 -i dev-id.p12 | gh secret set APPLE_CERTIFICATE --repo "$REPO"
printf '%s' "$PASSWORD" | gh secret set APPLE_CERTIFICATE_PASSWORD --repo "$REPO"
printf '%s' "$IDENTITY" | gh secret set APPLE_SIGNING_IDENTITY --repo "$REPO"
base64 -i "$P8"        | gh secret set APPLE_API_KEY_BASE64 --repo "$REPO"
printf '%s' "$KEY_ID"  | gh secret set APPLE_API_KEY --repo "$REPO"
printf '%s' "$ISSUER"  | gh secret set APPLE_API_ISSUER --repo "$REPO"

unset PASSWORD

echo
echo "Six secrets set on $REPO:"
gh secret list --repo "$REPO"

echo
echo "Optional, for signed builds on this machine:"
echo "  security import $DIR/dev-id.p12 -k ~/Library/Keychains/login.keychain-db"
