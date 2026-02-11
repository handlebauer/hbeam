# hbeam

A 1-to-1 end-to-end encrypted pipe over [HyperDHT](https://github.com/holepunchto/hyperdht).

Pipe data between two machines through a peer-to-peer encrypted tunnel. No server, no accounts. Just a shared passphrase or a persistent identity.

## Install

```bash
npm install -g hbeam
```

## CLI

### Send

Pipe data in and hbeam generates a passphrase (copied to your clipboard):

```bash
echo 'hello world' | hbeam
```

```
  HBEAM ·····
  PASSPHRASE
  nbsk4wlqmfuw...
```

### Receive

Pass the passphrase on the other machine to receive:

```bash
hbeam nbsk4wlqmfuw...
```

### Listen with a known passphrase

Re-use a specific passphrase with `--listen`:

```bash
echo 'hello again' | hbeam <passphrase> --listen
```

### Listen with a persistent identity

Listen on a stable public key instead of a one-off passphrase. Your identity is created automatically on first use and stored at `~/.config/hbeam/identity.json`:

```bash
hbeam --listen
```

```
  HBEAM ·····
  PUBLIC KEY
  a1b2c3d4e5f6...
```

Share your public key once — peers can reconnect any time without a new passphrase.

### Address book

Save peers by name so you don't have to remember public keys:

```bash
# Add a peer
hbeam peers add workserver a1b2c3d4e5f6...

# List saved peers
hbeam peers ls
```

```
  PEERS

  workserver  a1b2c3d4...  2d ago
```

```bash
# Connect by name
hbeam connect workserver

# Remove a peer
hbeam peers rm workserver
```

Peers are stored locally at `~/.config/hbeam/peers.json`.

### Show your identity

Print your public key (and copy it to the clipboard):

```bash
hbeam whoami
```

```
  IDENTITY
  a1b2c3d4e5f6...
```

### Serve a single file

Serve one file over an encrypted hbeam session:

```bash
hbeam serve ./report.pdf
```

This announces a one-time passphrase by default. To serve from your persistent identity instead:

```bash
hbeam serve ./report.pdf --listen
```

On the receiving side, connect normally (`hbeam <passphrase>` or `hbeam connect <name>`). hbeam detects the incoming file header and prompts where to save it. Use `-o` to skip the prompt:

```bash
hbeam <passphrase> -o ./downloads/report.pdf
hbeam connect workserver -o ./downloads/report.pdf
```

If stdout is piped, hbeam writes raw file bytes to stdout so shell redirection works:

```bash
hbeam <passphrase> > report.pdf
```

### Options

```
-l, --listen   Listen using passphrase or identity
-o, --output   Save incoming file to a specific path
-h, --help     Show help
-v, --version  Show version
```

## How it works

1. A 32-byte random seed is generated and encoded as a base32 passphrase.
2. A Noise keypair is deterministically derived from the passphrase using `sodium-universal`.
3. An ephemeral HyperDHT node announces (server) or connects (client) using that keypair.
4. The Noise protocol negotiates an encrypted session between the two peers.
5. Data flows through a `streamx` duplex stream — stdin/stdout on the CLI, or any readable/writable in code.

When using identity mode (`--listen` without a passphrase, or `connect`), a persistent keypair is loaded from `~/.config/hbeam/identity.json` instead of deriving one from a passphrase. The connection is still end-to-end encrypted via Noise.

All traffic is end-to-end encrypted. The DHT is only used for peer discovery; it never sees the plaintext.

## Requirements

- Node.js >= 20

## License

MIT
