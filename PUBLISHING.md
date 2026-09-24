# Publishing `@vitrina/api`

## Why this repository is public

The SDK is generated inside `vitrina-app`, which is private. npm refuses to mint
a provenance attestation from a private source repository:

```
422 Unsupported GitHub Actions source repository visibility: "private".
    Only public source repositories are supported when publishing with provenance.
```

That is what failed v11.3.0 and v11.4.0's publish job. A public mirror is the only
way to get provenance, and provenance is what lets a consumer verify the tarball
was built by a known workflow from a known commit rather than uploaded by hand.

Nothing secret lives here. This repository contains the SDK source, the published
OpenAPI projection (`openapi.public.json`, which is the same document the docs site
serves) and the generated types. Every example value in it is a placeholder.

## How a release happens

1. `packages/api-sdk` changes land in `vitrina-app` as usual.
2. `scripts/sync-from-monorepo.sh` copies the package and the spec here.
3. Bump `package.json`'s version to the platform release it describes, commit, tag
   `vX.Y.Z`, push the tag.
4. `.github/workflows/publish.yml` builds, tests and publishes over OIDC.

The version a package carries is the release it describes: `@vitrina/api@11.2.0`
documents API 11.2.0. A release can skip the SDK if its publish fails, so the
registry is the list — `npm view @vitrina/api versions`.

## One-time setup

- [x] Repository public (provenance requires it).
- [x] `npm-publish` environment, restricted to `v*` tags.
- [ ] **On npmjs.com, by an npm org owner:** `@vitrina/api` → Settings →
      **Trusted Publisher** → GitHub Actions → organization `VitrinaDev`,
      repository `vitrina-api`, workflow `publish.yml`, environment `npm-publish`.

That last one replaces the trusted publisher currently pointing at `vitrina-app`.
npm does not validate the configuration when you save it — a typo surfaces only as
a failed publish, so the first tag after changing it is the real test.

## No npm token

There is none, and there should not be. OIDC exchanges the workflow's `id-token`
for a short-lived credential. If you find yourself adding `NODE_AUTH_TOKEN`, the
trusted publisher is misconfigured — fix that instead.
