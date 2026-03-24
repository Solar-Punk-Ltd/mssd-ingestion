# mssd-ingestion Server

A live streaming ingestion server that receives SRT streams via [SRS](https://github.com/ossrs/srs), segments them into HLS, and uploads segments to the Swarm decentralized network. Stream discovery is handled via GSOC.

## Architecture

```
OBS/FFmpeg
    |
    | SRT (UDP)
    v
SRS (Docker) ──── writes HLS segments to disk
    |
    | HTTP callbacks (on_publish, on_hls, on_unpublish)
    v
Node.js App ──── uploads segments to Swarm
    |              builds live + VOD manifests
    |              broadcasts via GSOC
    v
Swarm Network ◄── Players pull segments from here
```

**Event-driven**: SRS notifies the Node app the instant each segment is ready via `on_hls` callback. No file polling.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [pnpm](https://pnpm.io/)
- [Docker](https://www.docker.com/) (for SRS)
- A running Swarm Bee node

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Build
pnpm build

# 3. Configure
cp .env.sample .env
# Edit .env with your Bee node URL, stamp, keys, etc.

# 4. Start SRS media server
pnpm srs:up

# 5. Start the ingestion server
pnpm start

# 6. Stream from OBS (see OBS Setup below)
```

## Configuration

### Environment Variables

Copy `.env.sample` to `.env` and configure:

**Swarm / Bee node:**

| Variable | Description | Example |
|----------|-------------|---------|
| `BEE_URL` | Bee node API endpoint | `http://localhost:1633` |
| `STAMP` | Postage stamp ID for uploads | `0x0123...` |
| `MANIFEST_ACCESS_URL` | (Optional) Gateway URL for segment access in manifests | `https://gateway.example.com/bytes` |
| `STREAM_KEY` | Private key for signing feeds and GSOC messages | `6eaf...` |

**Stream discovery (GSOC):**

| Variable | Description |
|----------|-------------|
| `GSOC_RESOURCE_ID` | Mined GSOC resource ID |
| `GSOC_TOPIC` | GSOC topic string |

**Webhook server:**

| Variable | Default | Description |
|----------|---------|-------------|
| `WEBHOOK_PORT` | `3000` | Port for receiving SRS callbacks |

**SRS media server** (used by `srs/docker-compose.yml`):

| Variable | Default | Description |
|----------|---------|-------------|
| `SRS_SRT_PORT` | `10080` | External SRT port (mapped to container) |
| `SRT_PASSPHRASE` | (empty) | SRT AES encryption passphrase |
| `SRS_MEDIA_PATH` | `../media` | Shared media directory |

### OBS Studio Setup

1. Go to **Settings > Stream**
2. Set **Service** to `Custom`
3. Set **Server** to:
   - **Video**: `srt://your_server_ip:10080?streamid=#!::r=video/mystream,m=publish`
   - **Audio only**: `srt://your_server_ip:10080?streamid=#!::r=audio/mystream,m=publish`
4. If `SRT_PASSPHRASE` is set, it's handled at the SRT transport level (configured in SRS, matched by OBS SRT settings).

## Running

### Start SRS

```bash
pnpm srs:up        # Start SRS in background
pnpm srs:logs      # View SRS logs
pnpm srs:down      # Stop SRS
```

### Start the Ingestion Server

```bash
pnpm start
# Or with custom media path:
node dist/index.js ./my_media_dir
```

## Testing

### Unit Tests

```bash
pnpm test
```

### Send a Test Stream

Video + audio test pattern:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 \
  -f lavfi -i sine=frequency=1000 \
  -c:v libx264 -preset veryfast -g 45 -c:a aac -b:a 128k \
  -f mpegts "srt://localhost:10080?streamid=#!::r=video/test,m=publish"
```

Audio-only test:

```bash
ffmpeg -f avfoundation -i ":0" -ac 1 -c:a aac -b:a 128k \
  -f mpegts "srt://localhost:10080?streamid=#!::r=audio/test,m=publish"
```

## How It Works

1. **Stream starts**: OBS sends SRT stream to SRS. SRS calls `on_publish` webhook. Node app creates a `SwarmStreamUploader`.
2. **Every 1.5s**: SRS writes a `.ts` segment and calls `on_hls` webhook. Node app immediately reads the segment, uploads it to Swarm, and updates the live manifest.
3. **Stream ends**: SRS calls `on_unpublish` webhook. Node app drains any in-flight uploads, finalizes the VOD manifest with `#EXT-X-ENDLIST`, and broadcasts a GSOC stop message.

Players discover streams via GSOC and pull segments directly from Swarm.

## Swarm Playback

Stream details are logged on start and stop. The feed is accessible at:

```
GET <bee_url>/feeds/<owner>/<topic>
```

Where `owner` is derived from `STREAM_KEY` and `topic` is randomly generated per stream session.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm build` | Compile TypeScript |
| `pnpm start` | Start the ingestion server |
| `pnpm srs:up` | Start SRS Docker container |
| `pnpm srs:down` | Stop SRS Docker container |
| `pnpm srs:logs` | Tail SRS logs |
| `pnpm test` | Run unit tests |
| `pnpm lint` | Run ESLint |
| `pnpm coverage` | Run tests with coverage |

## Resources

- [SRS (Simple Realtime Server)](https://github.com/ossrs/srs)
- [Swarm Feeds](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds)
- [GSOC Introduction](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc/#introduction)
- [SRT Protocol](https://www.haivision.com/products/srt-secure-reliable-transport/)
- [Swarm Stream Aggregator](https://github.com/Solar-Punk-Ltd/swarm-stream-aggregator-js)
