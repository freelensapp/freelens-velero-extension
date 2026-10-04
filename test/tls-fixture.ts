import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

// A certificate of an authority made for the test, for a name and for the other names it is given.
export async function createTlsFixture(hostname = "storage.example.invalid", also: string[] = []) {
  for (const name of [hostname, ...also])
    if (!/^[a-z0-9.-]+$/.test(name) || name.length > 253) throw new Error("Invalid synthetic TLS hostname");
  const directory = await mkdtemp(join(tmpdir(), "velero-tls-"));
  const execute = promisify(execFile);
  const caKey = join(directory, "ca.key");
  const caFile = join(directory, "ca.crt");
  const keyFile = join(directory, "server.key");
  const requestFile = join(directory, "server.csr");
  const certificateFile = join(directory, "server.crt");
  const names = `subjectAltName=${[hostname, ...also, "api.example.invalid"].map((name) => `DNS:${name}`).join(",")},IP:127.0.0.1,IP:::1`;
  // Another certificate of the same authority, for the same names and with the same key, that a client
  // refuses: one for the purpose of a client and not of a server, or one whose validity has ended. A
  // certificate signed for no day at all has expired as soon as it is made.
  const flawed = async (flaw: "purpose" | "expired") => {
    const request = join(directory, `${flaw}.csr`);
    const certificate = join(directory, `${flaw}.crt`);

    await execute(
      "openssl",
      [
        "req",
        "-new",
        "-key",
        keyFile,
        "-out",
        request,
        "-subj",
        `/CN=${hostname}`,
        "-addext",
        names,
        ...(flaw === "purpose" ? ["-addext", "extendedKeyUsage=clientAuth"] : []),
      ],
      { timeout: 30_000 },
    );
    await execute(
      "openssl",
      [
        "x509",
        "-req",
        "-in",
        request,
        "-CA",
        caFile,
        "-CAkey",
        caKey,
        "-CAcreateserial",
        "-out",
        certificate,
        "-days",
        flaw === "expired" ? "0" : "1",
        "-copy_extensions",
        "copy",
      ],
      { timeout: 30_000 },
    );
    return readFile(certificate, "utf8");
  };

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
        names,
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
      flawed,
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
