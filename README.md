# mssd-ingestion Server

A robust RTMP ingestion server designed for generating HLS (HTTP Live Streaming) streams, with integrated support for
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

The `mssd-ingestion` server provides comprehensive functionality to handle Real-Time Messaging Protocol (RTMP)
connections. It manages server-side operations for establishing and maintaining RTMP streams, processing incoming media,
generating HLS playlists and segments, and leveraging Swarm for decentralized content distribution and discovery.

This project acts as a streaming ingestion hub, enabling content creators to stream via RTMP (e.g., using OBS Studio),
have their streams automatically converted to HLS, and then distributed via Swarm.

## Features

- **RTMP Ingestion**: Accepts RTMP streams from clients like OBS Studio or other compatible software.
- **HLS Generation**: Automatically converts incoming RTMP streams into HLS format ( `.m3u8` playlists and `.ts`
  segments).
- **Swarm Integration**: Uploads generated HLS segments and manifests to the Swarm network.
- **Dynamic Manifests**: Creates and manages both live and VOD (Video on Demand) HLS manifests.
- **GSOC Broadcasting**: Announces stream start and stop events using GSOC for decentralized stream discovery by
  aggregators or dApps.
- **Secure Streaming**: Implements HMAC-based authentication for RTMP stream keys.
- **Video / only Audio**: Support for only audio stream

## Architectural Overview

1.  **Authenticated Ingestion**: The server receives an RTMP stream from a client (e.g., OBS Studio), authenticated
    using a signed stream key.
2.  **Stream Transcoding**: The `node-media-server` library is utilized to transform the incoming RTMP stream into an
    HLS stream.
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
- [FFmpeg](https://ffmpeg.org/) (For media processing and HLS generation)
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

For secure stream ingestion, the server uses HMAC-based authentication for RTMP stream keys. The `RTMP_SECRET`
environment variable is crucial for this process.

1.  **Set the `RTMP_SECRET`**: This secret key is used to sign and verify stream keys. It can be set as an environment
    variable, defined in a `.env` file, or provided directly during command execution.

    ```bash
    export RTMP_SECRET=your_super_secret_key
    ```

    Alternatively, include `RTMP_SECRET=your_super_secret_key` in your `.env` file.

2.  **Generate the Stream Key**: Use the provided npm script. The `-s` flag specifies the stream name, and `-e` defines
    the expiration duration in minutes.

    ```bash
    (RTMP_SECRET=test_secret) npm run generate-stream-key -- -s my_stream_name -e 60
    ```

    **Example Output**:

    ```
    [time] [LOG] - OBS Stream Key: my_stream_name?exp=1744276392&sign=6a22edfc68c073ab71dee70ce3f8907a20ab0795b958aa67499840e6483a80ab
    [time] [LOG] - Full RTMP URL example: rtmp://localhost/video/my_stream_name?exp=1744276392&sign=6a22edfc68c073ab71dee70ce3f8907a20ab0795b958aa67499840e6483a80ab
    ```

    The `exp` parameter indicates the expiration time as a Unix timestamp (seconds), and `sign` is the HMAC signature.

3.  **Configure Your Streaming Client (e.g., OBS Studio)**:

    - **Server URL**: `rtmp://<your_server_ip_or_domain>/video/`
    - **Stream Key**: Use the "OBS Stream Key" output (e.g., `my_stream_name?exp=...&sign=...`)

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
- `RTMP_SECRET`: The secret key used for HMAC stream key authentication, as detailed above.

More about how to setup a GSOC node:
[GSOC Introduction (Swarm Documentation)](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc/#introduction)

## Running the Server

Start the RTMP server by providing the path to your media root directory (where HLS files will be stored locally) and,
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

## Testing the Setup

You can use FFmpeg to send test streams to your running `mssd-ingestion` server to verify its functionality.

### Sending Video Test Streams

This command generates a test video pattern with audio and streams it via RTMP:

```bash
ffmpeg -re -f lavfi -i testsrc=size=1280x720:rate=30 -f lavfi -i sine=frequency=1000 -c:v libx264 -preset veryfast -b:v 1500k -g 50 -c:a aac -b:a 128k -ar 44100 -f flv "rtmp://localhost/video/test_video_stream?exp=<EXP_TIMESTAMP>&sign=<SIGNATURE>"
```

Replace `<EXP_TIMESTAMP>` and `<SIGNATURE>` with values from a freshly generated stream key for `test_video_stream`.

### Sending Audio-Only Test Streams

This command captures audio from the default microphone (macOS example) and streams it:

```bash
ffmpeg -f avfoundation -i ":0" -ac 1 -c:a aac -b:a 128k -f flv "rtmp://localhost:1935/audio/test_audio_stream?exp=<EXP_TIMESTAMP>&sign=<SIGNATURE>"
```

Replace `<EXP_TIMESTAMP>` and `<SIGNATURE>` similarly for `test_audio_stream`. Adjust input `-i` for your operating
system if not macOS.

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
    RTMP_SECRET=your_secret npm run generate-stream-key -- -s live_event -e 120
    ```
    Copy the output stream key (e.g., `live_event?exp=...&sign=...`).
3.  **Start the Server**:
    ```bash
    node dist/index.js ./media_files /opt/homebrew/bin/ffmpeg
    ```
4.  **Configure OBS**: Set Server to `rtmp://localhost/video/` and Stream Key to the generated key. Start streaming from
    OBS.
5.  **Verify Local HLS**: Open `http://localhost:8000/video/live_event/index.m3u8` in VLC.
6.  **Verify Swarm HLS (if aggregator is set up)**: Access the stream via the Swarm URL provided by your aggregator or
    GSOC feed lookup.

## Important Notes

- Ensure the `<MEDIAROOT_PATH>` directory exists and is writable by the user running the server.
- The FFmpeg binary must be executable and correctly pathed if not in the system's default PATH.
- Correctly configured Environment Variables are crucial for server operation, especially for Swarm integration and HMAC
  authentication.
- Firewall: Ensure port 1935 (default RTMP) and the HTTP port for HLS (default 8000) are open if accessing the server
  remotely.
- Swarm Connectivity: Verify that the server can connect to your Bee Swarm node and that the provided postage stamp
  (`STAMP`) is valid and has sufficient balance.
- If you want only audio stream use `rtmp://localhost/audio` as an RTMP sender.

## Resources

- [Swarm Feeds Documentation](https://docs.ethswarm.org/docs/develop/tools-and-features/feeds#what-are-feeds)
- [GSOC Introduction (Swarm Documentation)](https://docs.ethswarm.org/docs/develop/tools-and-features/gsoc/#introduction)
- [Example Stream Aggregator: Solar-Punk-Ltd/swarm-stream-aggregator-js](https://github.com/Solar-Punk-Ltd/swarm-stream-aggregator-js)
-
  [Example Stream Client: Solar-Punk-Ltd/swarm-ingestion-stream-react-example](https://github.com/Solar-Punk-Ltd/swarm-ingestion-stream-react-example)
