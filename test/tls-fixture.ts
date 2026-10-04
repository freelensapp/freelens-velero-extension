import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

export async function createTlsFixture(hostname = "storage.example.invalid") {
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.length > 253) throw new Error("Invalid synthetic TLS hostname");
  const directory = await mkdtemp(join(tmpdir(), "velero-tls-"));
  const execute = promisify(execFile);
  const caKey = join(directory, "ca.key");
  const caFile = join(directory, "ca.crt");
  const keyFile = join(directory, "server.key");
  const requestFile = join(directory, "server.csr");
  const certificateFile = join(directory, "server.crt");

  try {
    await execute(
      "openssl",
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        caKey,
        "-out",
        caFile,
        "-days",
        "1",
        "-subj",
        "/CN=Velero Local Test CA",
        "-addext",
        "basicConstraints=critical,CA:TRUE",
      ],
      { timeout: 30_000 },
    );
    await execute(
      "openssl",
      [
        "req",
        "-new",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        keyFile,
        "-out",
        requestFile,
        "-subj",
        `/CN=${hostname}`,
        "-addext",
        `subjectAltName=DNS:${hostname},DNS:api.example.invalid,IP:127.0.0.1,IP:::1`,
      ],
      { timeout: 30_000 },
    );
    await execute(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        requestFile,
        "-CA",
        caFile,
        "-CAkey",
        caKey,
        "-CAcreateserial",
        "-out",
        certificateFile,
        "-days",
        "1",
        "-copy_extensions",
        "copy",
      ],
      { timeout: 30_000 },
    );
    await chmod(caKey, 0o600);
    await chmod(keyFile, 0o600);
    return {
      directory,
      ca: await readFile(caFile, "utf8"),
      cert: await readFile(certificateFile, "utf8"),
      key: await readFile(keyFile, "utf8"),
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
