import { bash, readFile, writeFile, listDir, release } from "./provider"

const sid = "smoke-1"

console.log("--- bash uname")
console.log(await bash(sid, "uname -a; echo ---; cat /etc/os-release | head -3"))

console.log("--- write + read file")
await writeFile(sid, "/tmp/harness/hello.txt", "hello from harness\nline 2\n")
console.log(await readFile(sid, "/tmp/harness/hello.txt"))

console.log("--- list dir")
console.log(await listDir(sid, "/tmp/harness"))

console.log("--- bash python (after apt? no — just check what's there)")
console.log(await bash(sid, "which python3 || which python; ls /bin | head -5"))

console.log("--- exit code propagation")
console.log(await bash(sid, "false"))
console.log(await bash(sid, "exit 42"))

console.log("--- release")
await release(sid)
console.log("done")
