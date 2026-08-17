# Releasing

The application is distributed directly, not through the App Store. macOS will
refuse to open a downloaded application unless Apple has signed off on it, which
takes two things: a signature made with a Developer ID certificate, and a
notarisation ticket from Apple stapled to the bundle. Both happen in
`.github/workflows/release.yml`; this file is about getting it the credentials.

## Why not the App Store

The store requires the sandbox, and two things this application does are outside
it. It reads images sitting beside the document, which the sandbox does not
grant just because the document was opened, and it watches the folder the
document is in, which the user never picked. Both would need security scoped
bookmarks and a different design.

## One time: the certificate

The account already has *Apple Development* and *Apple Distribution*
certificates. Neither of them works here. Development is for running on your own
machines, Distribution is for the App Store. Direct distribution needs a third.

Everything below keeps its files in `~/.private/paperv2`, outside the repository.
A private key inside a working tree is one `git add .` away from being published.

Make the key and the certificate request. This replaces the Keychain Access
*Request a Certificate From a Certificate Authority* dance, and puts the private
key in a file we can hand to CI rather than inside a keychain we would have to
export it from:

```bash
asc certificates csr generate --common-name "Developer ID Application: Hasan Rafi" --organization "Hasan Rafi" --key-out ~/.private/paperv2/dev-id.key --csr-out ~/.private/paperv2/dev-id.csr
```

**The certificate itself has to be issued in the web portal.** `asc certificates
create` is the obvious route and it does not work here: the App Store Connect API
refuses with *"This operation can only be performed by the Account Holder"*, and
that is a property of the endpoint, not of the key's role. No API key of any role
can issue a Developer ID certificate. So:

1. Certificates, Identifiers & Profiles → Certificates → **+**
2. Choose **Developer ID Application**, and the **G2 Sub-CA** profile
3. Upload `~/.private/paperv2/dev-id.csr`
4. Download the `.cer` into `~/.private/paperv2`

Keep `dev-id.key`. It is the half Apple never sees, and a certificate without it
is worthless; losing it means starting again from a new request.

## One time: the notarisation key

A key made for this, rather than a personal one, so it can be revoked without
taking anything else down:

```bash
asc web api-keys create --name "PaperV2 release" --role DEVELOPER --output-dir ~/.private/paperv2
```

This needs an Apple web session (`asc web auth login --apple-id ...`), because it
is another Account Holder or Admin operation. It writes `AuthKey_<KEYID>.p8` at
mode 600 and never prints the contents.

## The secrets

`scripts/release-secrets.sh` builds the `.p12` from the certificate and the key,
reads the signing identity off the certificate rather than trusting it to be
typed correctly, and sets all six. The `.p12` password is generated, piped to
GitHub, and discarded: nothing reads it again.

```bash
./scripts/release-secrets.sh
```

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | the `.p12`, base64 encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the generated password |
| `APPLE_SIGNING_IDENTITY` | the full name, `Developer ID Application: Hasan Rafi (TEAMID)` |
| `APPLE_API_KEY_BASE64` | the `.p8`, base64 encoded |
| `APPLE_API_KEY` | the key id, the ten characters in the `.p8` filename |
| `APPLE_API_ISSUER` | the issuer id, from `asc auth issuer-id` |

Nothing else is needed. `GITHUB_TOKEN` is provided by Actions.

The one part of that script worth knowing about if you ever redo it by hand is
`openssl pkcs12 -export -legacy`. OpenSSL 3 encrypts with AES-256 by default and
the `security import` that runs on the macOS runner cannot read it, so a `.p12`
made without the flag fails partway through a release with a MAC verification
error that says nothing about the cause.

## Cutting a release

Set the version in three places, which have to agree: `package.json`,
`src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`. Then:

```bash
git tag v0.2.0
git push origin v0.2.0
```

The workflow builds a universal binary, signs it, waits for Apple, staples the
ticket, and leaves a **draft** release with the `.dmg` attached. Look at it, then
publish.

## Checking a build before anyone downloads it

**Check the disk image, not only the application.** Tauri notarises the `.app`
and staples it, then builds the `.dmg` around the result and only signs that. An
application that passes every check can still sit inside a container that macOS
refuses to open, and the container is what gets double clicked first. The release
workflow notarises and staples the `.dmg` afterwards for that reason; this is how
to confirm it did.

```bash
xcrun stapler validate PaperV2_0.1.0_universal.dmg
spctl --assess --type open --context context:primary-signature -vv PaperV2_0.1.0_universal.dmg
```

`accepted` and `source=Notarized Developer ID`. If it says *Unnotarized Developer
ID*, the disk image was signed but never notarised, and a downloader gets "Apple
cannot check it for malicious software".

Then the application inside it:

```bash
spctl --assess --type execute -vv PaperV2.app   # should say: accepted, Notarized Developer ID
codesign -dv --verbose=4 PaperV2.app | grep -E "Authority|TeamIdentifier|Runtime"
xcrun stapler validate PaperV2.app              # should say: worked
```

Three `Authority` lines, ending at `Apple Root CA`. A missing middle line means
the `.p12` went up without its intermediate.

The surest test is a different Mac, or this one with the quarantine flag put
back on, which is what a download gets, and which is the only way the checks
above resemble a real launch:

```bash
xattr -w com.apple.quarantine "0081;00000000;Safari;" PaperV2.app
```

## What is not here

There is no auto update, on purpose: see the out of scope list in CLAUDE.md. A
new version means downloading it. If that changes, Tauri's updater needs its own
signing key, separate from anything above.
