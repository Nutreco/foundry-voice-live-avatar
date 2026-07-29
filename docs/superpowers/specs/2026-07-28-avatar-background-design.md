# Avatar Background and Preview Design

## Goal

Extend `avatar.json` with an optional background image URL and an explicit
preview-avatar mode. Remove the unsupported customized-avatar option.

## Configuration

The avatar configuration uses this shape:

```json
{
  "character": "lisa",
  "preview": false,
  "style": "casual-sitting",
  "video": {
    "resolution": { "width": 1920, "height": 1080 },
    "bitrate": 2000000,
    "codec": "h264",
    "background": {
      "imageUrl": "https://example.com/background.jpg"
    }
  }
}
```

`preview` is required. `customized` is removed from the supported schema.

For a normal avatar (`preview: false`), `style` is required and non-empty. For
a preview avatar (`preview: true`), `style` must be omitted. `preview` is a
local validation property and is not sent to the Voice Live service.

`video.background` is optional. When present, `imageUrl` is required and must
be an absolute HTTPS URL. The repository default remains a normal avatar,
retains its existing style, and omits the optional background.

## Server Projection and SDK Mapping

The typed server configuration carries:

- `Character`
- nullable `Style`
- required `Preview`
- optional video settings
- optional video background image URL

The SDK `AvatarConfiguration` is always constructed with `customized: false`.
`Style` is assigned only when the local config is not a preview avatar.

When configured, the image URL maps to:

```csharp
avatar.Video.Background = new VideoBackground
{
    ImageUrl = config.Video.Background.ImageUrl
};
```

The existing browser-safe avatar JSON remains a clone of `avatar.json`, so
clients continue receiving the configured `preview` and background fields.

## Validation

Startup validation rejects:

- missing `preview`
- missing or blank `style` when `preview` is false
- any supplied `style` when `preview` is true
- the removed `customized` field
- a non-object `video.background`
- missing or blank `video.background.imageUrl`
- a relative, malformed, or non-HTTPS background URL

Errors identify `avatar.json` and the exact invalid field.

## Testing and Documentation

Server tests cover:

- default normal-avatar projection
- background URL projection into `VideoParams.Background.ImageUrl`
- preview avatars omitting SDK style
- normal avatars requiring style
- preview avatars rejecting style
- missing preview
- removed customized field
- invalid background objects and URLs
- agent-mode avatar mapping

`docs/config-schema.md` and the default `config/avatar.json` are updated to
describe the new schema and conditional style requirements.

