# hbeam

A 1-to-1 end-to-end encrypted pipe over [HyperDHT](https://github.com/holepunchto/hyperdht).

Pipe data between two machines through a peer-to-peer encrypted tunnel. No server, no accounts. By default, hbeam uses your persistent identity; use `--temp` for one-time passphrase sessions.

## Install

```bash
npm install -g hbeam
```

## CLI

### Send (identity by default)

Pipe data in and hbeam announces using your persistent identity (created on first use at `~/.config/hbeam/identity.json`):

```bash
echo 'hello world' | hbeam
```

### Receive

Connect by saved name or public key:

```bash
hbeam connect workserver
```

### One-time passphrase mode

Use `--temp` when you want a throwaway passphrase flow:

```bash
# Generate and announce a one-time passphrase
echo 'hello world' | hbeam --temp

# Reuse a known passphrase and announce on it
echo 'hello again' | hbeam <passphrase> --temp

# Connect to an existing passphrase
hbeam <passphrase>
```

### Address book

Save peers by name so you do not have to remember public keys:

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

### Expose - TCP over P2P

Expose a local TCP service to a remote peer:

```bash
# Reverse proxy: expose localhost:3000 using your identity
hbeam expose 3000

# Reverse proxy: expose localhost:3000 with a one-time passphrase
hbeam expose 3000 --temp
```

```
  HBEAM ···

  ANNOUNCING
  a1b2c3d4e5f6...
  ONLINE [96.9.225.80:34725]
  FORWARDING localhost:3000
```

Access a remote peer's service locally:

```bash
# Forward proxy: connect to a saved peer, listen on local port 8080
hbeam connect workserver -p 8080

# Forward proxy: connect by passphrase (one-time mode)
hbeam connect <passphrase> -p 8080 --temp
```

```
  HBEAM ···

  CONNECTING workserver
  ONLINE [96.9.225.80:34725]
  LISTENING 127.0.0.1:8080
```

Any TCP traffic (HTTP, SSH, databases, etc.) can be tunneled. Both sides are end-to-end encrypted via Noise.

### Serve a single file

Serve one file over an encrypted hbeam session:

```bash
hbeam serve ./report.pdf
```

This serves from your persistent identity by default. For one-time passphrase mode instead:

```bash
hbeam serve ./report.pdf --temp
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
-t, --temp     Use one-time passphrase mode
-o, --output   Save incoming file to a specific path
-p, --port     Local listen port (connect forward mode)
--host         Target/listen host (expose/connect mode, default: localhost)
-h, --help     Show help
-v, --version  Show version
```

## How it works

Identity mode (default):

1. A persistent Noise keypair is loaded from `~/.config/hbeam/identity.json` (or created on first use).
2. A HyperDHT node announces (server) or connects (client) using that keypair.
3. The Noise protocol negotiates an encrypted session between the two peers.
4. Data flows through a `streamx` duplex stream - stdin/stdout on the CLI, or any readable/writable in code.

One-time mode (`--temp`):

1. A 32-byte random seed is generated and encoded as a base32 passphrase.
2. A Noise keypair is deterministically derived from that passphrase using `sodium-universal`.
3. An ephemeral HyperDHT node announces (server) or connects (client) using that keypair.

All traffic is end-to-end encrypted. The DHT is only used for peer discovery; it never sees plaintext.

## Requirements

- Node.js >= 20

## License

MIT
