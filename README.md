# hbeam

A 1-to-1 end-to-end encrypted pipe over [HyperDHT](https://github.com/holepunchto/hyperdht).

Pipe data between two machines through a peer-to-peer encrypted tunnel. No server, no accounts — just a shared passphrase.

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

### Options

```
-l, --listen   Listen (announce) using the provided passphrase
-h, --help     Show help
-v, --version  Show version
```

## How it works

1. A 32-byte random seed is generated and encoded as a base32 passphrase.
2. A Noise keypair is deterministically derived from the passphrase using `sodium-universal`.
3. An ephemeral HyperDHT node announces (server) or connects (client) using that keypair.
4. The Noise protocol negotiates an encrypted session between the two peers.
5. Data flows through a `streamx` duplex stream — stdin/stdout on the CLI, or any readable/writable in code.

All traffic is end-to-end encrypted. The DHT is only used for peer discovery; it never sees the plaintext.

## Requirements

- Node.js >= 20

## License

MIT
