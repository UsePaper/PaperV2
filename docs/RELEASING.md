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
machines, Distribution is for the App Store. Direct distribution needs a third:

1. Go to Certificates, Identifiers & Profiles → Certificates → **+**
2. Choose **Developer ID Application**
3. Follow the certificate signing request steps, download, and double click to
   install it

Check it landed:

```bash
security find-identity -v -p codesigning | grep "Developer ID Application"
```

Then export it for CI, from Keychain Access → right click the certificate →
Export → `.p12`, with a password:

```bash
base64 -i Certificates.p12 | pbcopy   # this is APPLE_CERTIFICATE
```

## One time: the notarisation key

App Store Connect → Users and Access → Integrations → Team Keys → **+**, with
the *Developer* role. Download the `.p8`. It can only be downloaded once.

```bash
base64 -i AuthKey_XXXXXXXXXX.p8 | pbcopy   # this is APPLE_API_KEY_BASE64
```

## The secrets

Settings → Secrets and variables → Actions, on the repository:

| Secret | What it is |
|---|---|
| `APPLE_CERTIFICATE` | the `.p12`, base64 encoded |
| `APPLE_CERTIFICATE_PASSWORD` | the password used when exporting it |
| `APPLE_SIGNING_IDENTITY` | the full name, `Developer ID Application: Hasan Rafi (TEAMID)` |
| `APPLE_API_KEY_BASE64` | the `.p8`, base64 encoded |
| `APPLE_API_KEY` | the key id, the ten characters in the `.p8` filename |
| `APPLE_API_ISSUER` | the issuer id, a uuid on the same App Store Connect page |

Nothing else is needed. `GITHUB_TOKEN` is provided by Actions.

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

```bash
spctl --assess --type execute -vv PaperV2.app   # should say: accepted, Notarized Developer ID
codesign -dv --verbose=4 PaperV2.app | grep -E "Authority|TeamIdentifier|Runtime"
xcrun stapler validate PaperV2.app              # should say: worked
```

The surest test is a different Mac, or this one with the quarantine flag put
back on, which is what a download gets:

```bash
xattr -w com.apple.quarantine "0081;00000000;Safari;" PaperV2.app
```

## What is not here

There is no auto update, on purpose: see the out of scope list in CLAUDE.md. A
new version means downloading it. If that changes, Tauri's updater needs its own
signing key, separate from anything above.
