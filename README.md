# mssd-ingestion Server

A robust SRT ingestion server designed for generating HLS (HTTP Live Streaming) streams, with integrated support for
uploading content to the Swarm decentralized storage network and broadcasting stream status via GSOC.

## Table of Contents

1. [Overview](#overview)
2. [Features](#features)
3. [Architectural Overview](#architectural-overview)
4. [Prerequisites](#prerequisites)
5. [Installation](#installation)
6. [Building the Project](#building-the-project)
7. [Configuration](#configuration)

   - [HMAC Stream Key Generation](#hmac-stream-key-generation)
   - [Environment Variables](#environment-variables)

8. [Running the Server](#running-the-server)
9. [Testing the Setup](#testing-the-setup)

   - [Sending Video Test Streams](#sending-video-test-streams)
   - [Sending Audio-Only Test Streams](#sending-audio-only-test-streams)

10. [Accessing HLS Streams](#accessing-hls-streams)

    - [Local HLS Playback](#local-hls-playback)
    - [Swarm HLS Playback](#swarm-hls-playback)

11. [Complete Workflow Example](#complete-workflow-example)
12. [Important Notes](#important-notes)
13. [Further Reading & Resources](#further-reading--resources)

## Overview

The `mssd-ingestion` server provides comprehensive functionality to handle SRT (Secure Reliable Transport)
connections. It manages server-side operations for establishing and maintaining SRT streams, processing incoming media,
generating HLS playlists and segments, and leveraging Swarm for decentralized content distribution and discovery.

This project acts as a streaming ingestion hub, enabling content creators to stream via SRT (e.g., using OBS Studio),
have their streams automatically converted to HLS, and then distributed via Swarm.

## Features

- **SRT Ingestion**: Accepts SRT streams from clients like OBS Studio or other compatible software. Uses FFmpeg in
  listener mode with two pre-started processes: video (port 9000) and audio (port 9001).
- **HLS Generation**: Automatically converts incoming SRT streams into HLS format (`.m3u8` playlists and `.ts`
  segments).
- **Swarm Integration**: Uploads generated HLS segments and manifests to the Swarm network.
- **Dynamic Manifests**: Creates and manages both live and VOD (Video on Demand) HLS manifests.
- **GSOC Broadcasting**: Announces stream start and stop events using GSOC for decentralized stream discovery by
  aggregators or dApps.
- **Secure Streaming**: Implements HMAC-based authentication for stream keys, with optional SRT AES encryption via
  passphrase.
- **Video / Audio**: Separate SRT ports for video and audio streams.
- **Auto-Restart**: FFmpeg processes automatically restart after a stream ends, ready for the next connection.

## Architectural Overview

1.  **Authenticated Ingestion**: The server receives an SRT stream from a client (e.g., OBS Studio), authenticated
    using a signed stream key passed via the SRT `streamid` parameter.
2.  **Stream Processing**: FFmpeg in SRT listener mode receives the incoming MPEG-TS stream and converts it to HLS.
    Two FFmpeg processes run simultaneously: one for video on port 9000 and one for audio on port 9001.
3.  **Segment Monitoring & Upload**: A file watcher actively monitors the designated media directory for new HLS
    segments (`.ts` files). As new segments are generated, they are uploaded to Swarm.
4.  **Manifest Management**: Concurrently, two types of HLS manifests (`.m3u8` files) are maintained:
    - **Live Manifest**: Adheres to standard HLS live streaming conventions, updated continuously as new segments become
      available.
    - **VOD Manifest**: Conforms to HLS VOD standards, finalized when the stream ends to represent the complete
      recording.
5.  **Swarm Manifest Upload**: During live streaming, the live HLS manifest is regularly uploaded to Swarm under the
    stream's feed. Upon stream termination, the final VOD manifest is uploaded.
6.  **Stream Discovery via GSOC**: To announce stream status (start/stop), the server sends GSOC updates. These updates
    can be captured by an aggregator service (e.g.,
    [swarm-stream-aggregator-js](https://github.com/Solar-Punk-Ltd/swarm-stream-aggregator-js)), which can then create a
    protected feed. This feed enables dApps to dynamically display, hide, or react to stream availability.

## Prerequisites

Ensure the following software is installed and configured on your system:

- [Node.js](https://nodejs.org/)
- [pnpm](https://pnpm.io/) (Package manager)
- [FFmpeg](https://ffmpeg.org/) (For SRT listening and HLS generation, must be compiled with SRT support)
- A running Swarm Bee Node (for interacting with the Swarm network)
- **(Optional)** For a demonstration of dApp integration:
  [swarm-stream-aggregator-js](https://github.com/Solar-Punk-Ltd/swarm-stream-aggregator-js)

## Installation

1.  Clone the repository:

    ```bash
    git clone https://github.com/Solar-Punk-Ltd/mssd-ingestion.git
    cd mssd-ingestion
    ```

2.  Install project dependencies:

    ```bash
    pnpm install
    ```

## Building the Project

To compile the TypeScript code into JavaScript, execute:

```bash
pnpm build
```

This will generate the compiled output in the `dist` directory.

## Configuration

### HMAC Stream Key Generation

For secure stream ingestion, the server uses HMAC-based authentication for stream keys. The `STREAM_SECRET`
environment variable is crucial for this process.

1.  **Set the `STREAM_SECRET`**: This secret key is used to sign and verify stream keys. It can be set as an environment
    variable, defined in a `.env` file, or provided directly during command execution.

    ```bash
    export STREAM_SECRET=your_super_secret_key
    ```

    Alternatively, include `STREAM_SECRET=your_super_secret_key` in your `.env` file.

2.  **Generate the Stream Key**: Use the provided npm script. The `-s` flag specifies the stream name, and `-e` defines
    the expiration duration in minutes.

    ```bash
    STREAM_SECRET=test_secret pnpm run generate-stream-key -- -s my_stream_name -e 60
    ```

    **Example Output**:

    ```
    [time] [LOG] - Stream Key: my_stream_name?exp=1744276392&sign=6a22edfc68c073ab71dee70ce3f8907a20ab0795b958aa67499840e6483a80ab
    [time] [LOG] - Video SRT URL: srt://localhost:9000?pkt_size=1316&streamid=my_stream_name%3Fexp%3D1744276392%26sign%3D...
    [time] [LOG] - Audio SRT URL: srt://localhost:9001?pkt_size=1316&streamid=my_stream_name%3Fexp%3D1744276392%26sign%3D...
    ```

    The `exp` parameter indicates the expiration time as a Unix timestamp (seconds), and `sign` is the HMAC signature.

3.  **Configure Your Streaming Client (e.g., OBS Studio)**:

    - **Service**: Custom
    - **Server**: `srt://your_server_ip:9000?pkt_size=1316` (for video)
    - **Stream Key**: Use the generated stream key as the `streamid` parameter

    For OBS, use the custom output URL format:
    ```
    srt://your_server_ip:9000?pkt_size=1316&streamid=my_stream_name%3Fexp%3D...%26sign%3D...
    ```

### Environment Variables

Before starting the server, ensure the following environment variables are correctly set (e.g., in a `.env` file based
on `.env.sample`):

- `BEE_URL`: The API endpoint URL of your Bee Swarm node (e.g., `http://localhost:1633`).
- `MANIFEST_ACCESS_URL`: The public base URL through which HLS segments will be accessed when referenced in manifests
  (this might be your Bee node's BZZ endpoint or a gateway).
- `GSOC_RESOURCE_ID`: The mined GSOC address (resource ID) of the node used for broadcasting stream status.
- `GSOC_TOPIC`: The topic string associated with the GSOC feed.
- `STREAM_KEY`: The private key (e.g., Ethereum-style private key) of the stream owner, used for signing GSOC messages.
- `STAMP`: A valid Swarm postage stamp ID required for uploading data to Swarm.
- `STREAM_SECRET`: The secret key used for HMAC stream key authentication, as detailed above.
- `SRT_PORT`: Base SRT port for video (default: `9000`). Audio uses `SRT_PORT + 1`.
- `SRT_PASSPHRASE`: (Optional) AES encryption passphrase for SRT connections.

More about how to setup a GSOC node:
[GSOC Introduction (Swarm Documentation)](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc/#introduction)

## Running the Server

Start the SRT server by providing the path to your media root directory (where HLS files will be stored locally) and,
optionally, the path to your FFmpeg binary. If the FFmpeg path is omitted, the system's default FFmpeg installation will
be used.

```bash
node dist/index.js <MEDIAROOT_PATH> [<FFMPEG_PATH>]
```

**Example**:

```bash
node dist/index.js ./media_output /usr/local/bin/ffmpeg
```

Make sure all required environment variables are set before running this command.

The server starts two FFmpeg processes in SRT listener mode:
- **Video**: Listens on `SRT_PORT` (default 9000)
- **Audio**: Listens on `SRT_PORT + 1` (default 9001)

Each FFmpeg process accepts one SRT connection at a time. When a stream ends, the process automatically restarts and
is ready for the next connection.

## Testing the Setup

You can use FFmpeg to send test streams to your running `mssd-ingestion` server to verify its functionality.

### Running Unit Tests

```bash
pnpm test
```

### Sending Video Test Streams

This command generates a test video pattern with audio and streams it via SRT:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=frequency=1000 -c:v libx264 -preset veryfast -b:v 1500k -g 50 -c:a aac -b:a 128k -ar 44100 -f mpegts "srt://localhost:9000?pkt_size=1316&streamid=test"
```

### Sending Audio-Only Test Streams

This command captures audio from the default microphone (macOS example) and streams it:

```bash
ffmpeg -f avfoundation -i ":0" -ac 1 -c:a aac -b:a 128k -f mpegts "srt://localhost:9001?pkt_size=1316&streamid=test"
```

Adjust input `-i` for your operating system if not macOS.

Upon successful ingestion, HLS files (`.m3u8` playlist and `.ts` segments) will be generated in the specified
`<MEDIAROOT_PATH>`.

## Accessing HLS Streams

### Local HLS Playback

Test the generated HLS stream using a compatible player like VLC Media Player:

1.  Open VLC.
2.  Navigate to **Media \> Open Network Stream...** (or equivalent).
3.  Enter the local HTTP URL for the stream's manifest:
    ```
    http://localhost:8000/video/<your_stream_name>/index.m3u8
    ```
    (Assuming the server's HTTP component runs on port 8000 and your stream name is `<your_stream_name>`).

### Swarm HLS Playback

Once segments and manifests are uploaded to Swarm and announced via GSOC, the HLS stream can be accessed through a Swarm
access point (e.g., your Bee node or a public gateway).

During start all your stream details are logged: `Broadcasting start with data: ${JSON.stringify(data)}` During stop all
your stream details are logged: `Broadcasting stop with data: ${JSON.stringify(data)}`

The owner of the feed is based on the STREAM_KEY you provided. The topic is randomly generated. You can manually call
the stream like this:

```
GET <bee url>/feeds/<owner>/<topic>
```

More about feeds:
[Swarm Feeds Documentation](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds#what-are-feeds)

## Complete Workflow Example

1.  **Configure**: Set up your `.env` file with all required variables.
2.  **Generate Stream Key**:
    ```bash
    STREAM_SECRET=your_secret pnpm run generate-stream-key -- -s live_event -e 120
    ```
    Copy the output stream key and SRT URLs.
3.  **Start the Server**:
    ```bash
    node dist/index.js ./media_files /opt/homebrew/bin/ffmpeg
    ```
4.  **Stream with OBS or FFmpeg**: Use the generated SRT URL to start streaming.
    - **Video**: `srt://localhost:9000?pkt_size=1316&streamid=<generated_key>`
    - **Audio**: `srt://localhost:9001?pkt_size=1316&streamid=<generated_key>`
5.  **Verify Local HLS**: Open the HLS URL in VLC.
6.  **Verify Swarm HLS (if aggregator is set up)**: Access the stream via the Swarm URL provided by your aggregator or
    GSOC feed lookup.

## Important Notes

- Ensure the `<MEDIAROOT_PATH>` directory exists and is writable by the user running the server.
- The FFmpeg binary must be executable and correctly pathed if not in the system's default PATH.
- FFmpeg must be compiled with SRT support (`--enable-libsrt`).
- Correctly configured Environment Variables are crucial for server operation, especially for Swarm integration and HMAC
  authentication.
- Firewall: Ensure ports 9000-9001 (default SRT) are open if accessing the server remotely.
- Swarm Connectivity: Verify that the server can connect to your Bee Swarm node and that the provided postage stamp
  (`STAMP`) is valid and has sufficient balance.
- SRT uses MPEG-TS as its container format. When configuring OBS or other streaming software, ensure the output format
  is set to MPEG-TS.

## Resources

- [Swarm Feeds Documentation](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds#what-are-feeds)
- [GSOC Introduction (Swarm Documentation)](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc/#introduction)
- [Example Stream Aggregator: Solar-Punk-Ltd/swarm-stream-aggregator-js](https://github.com/Solar-Punk-Ltd/swarm-stream-aggregator-js)
-
  [Example Stream Client: Solar-Punk-Ltd/swarm-ingestion-stream-react-example](https://github.com/Solar-Punk-Ltd/swarm-ingestion-stream-react-example)
- [SRT Protocol](https://www.haivision.com/products/srt-secure-reliable-transport/)
- [FFmpeg SRT Documentation](https://ffmpeg.org/ffmpeg-protocols.html#srt)
