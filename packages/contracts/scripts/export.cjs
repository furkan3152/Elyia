#!/usr/bin/env node
// Exports compiled artifacts and the deployment manifest for the web admin panel and the API.
//
// Writes:
//   packages/contracts/deploy/manifest.elysium-testnet.json   deterministic deploy plan (order, args, init calls, checks)
//   packages/core/src/contracts/<Name>.ts                      ABI (as const) + bytecode + version per contract
//   packages/core/src/contracts/manifest.ts                    the manifest as a typed constant
//   packages/core/src/contracts/index.ts                       barrel
//
// It never signs or broadcasts anything. Run after `hardhat compile` (npm run export).
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PKG = path.join(__dirname, "..");
const CORE_OUT = path.join(PKG, "..", "core", "src", "contracts");
const pkgJson = require(path.join(PKG, "package.json"));
const solidity = require(path.join(PKG, "solidity.config.cjs"));
const venues = require(path.join(PKG, "deploy", "elysium-testnet.venues.json"));

const CONTRACTS = [
  { name: "ElyiaRouter", deployable: true },
  { name: "ElyAccountFactory", deployable: true },
  { name: "ElyOrders", deployable: true },
  { name: "ElyAccount", deployable: false, note: "Do not deploy directly: ElyAccountFactory creates the implementation and EIP-1167 clones. Use the ABI to interact with accounts." },
];

const VENUE_KIND = { NONE: 0, WRAPPER: 1, V2_ROUTER: 2, V3_ROUTER_V1: 3, V3_ROUTER_02: 4, VAULT: 5 };

function readArtifact(name) {
  const p = path.join(PKG, "artifacts", "contracts", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(p)) throw new Error(`missing artifact ${p}; run hardhat compile first`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function sourceHash() {
  const h = crypto.createHash("sha256");
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "test") continue;
        walk(full);
      } else if (e.name.endsWith(".sol")) {
        h.update(path.relative(PKG, full));
        h.update(fs.readFileSync(full));
      }
    }
  };
  walk(path.join(PKG, "contracts"));
  return "0x" + h.digest("hex");
}

const compiler = {
  solc: solidity.version,
  optimizer: solidity.settings.optimizer,
  evmVersion: solidity.settings.evmVersion,
  viaIR: Boolean(solidity.settings.viaIR),
};
const version = pkgJson.version;
const srcHash = sourceHash();

const manifest = {
  $comment:
    "Deterministic deployment plan for the Elyia admin panel. The owner deploys from their own wallet, in `order`. " +
    "'$OWNER' = the connected wallet; '$ElyiaRouter' = the address produced by step 1. Nothing is pre-deployed. NOT AUDITED.",
  version,
  sourceHash: srcHash,
  compiler,
  network: venues.network,
  chainId: venues.chainId,
  order: [
    {
      step: 1,
      contract: "ElyiaRouter",
      constructor: [
        { name: "initialOwner", type: "address", value: "$OWNER" },
        { name: "permit2", type: "address", value: venues.permit2.address },
        { name: "venues", type: "address[]", value: venues.venues.map((v) => v.address) },
        { name: "kinds", type: "uint8[]", value: venues.venues.map((v) => VENUE_KIND[v.kind]) },
      ],
      venueLabels: venues.venues.map((v) => ({ key: v.key, kind: v.kind, address: v.address, source: v.source })),
    },
    { step: 2, contract: "ElyAccountFactory", constructor: [] },
    { step: 3, contract: "ElyOrders", constructor: [{ name: "router", type: "address", value: "$ElyiaRouter" }] },
  ],
  initCalls: [],
  optionalAdminCalls: [
    { contract: "ElyiaRouter", fn: "setProtocolFee(uint16,address)", note: "Default 0 bps. Hard cap 30 bps." },
    { contract: "ElyiaRouter", fn: "setIntegrator(address,uint16)", note: "Developer-portal integrators. Hard cap 50 bps." },
    { contract: "ElyiaRouter", fn: "setVenue(address,uint8)", note: "Add/remove venues. Kinds: " + JSON.stringify(VENUE_KIND) },
    { contract: "ElyiaRouter", fn: "pause()", note: "Kill switch." },
    { contract: "ElyiaRouter", fn: "transferOwnership(address)", note: "Two-step; new owner must acceptOwnership(). Prefer a multisig." },
  ],
  postDeployChecks: [
    { contract: "ElyiaRouter", call: "owner()", expect: "$OWNER" },
    { contract: "ElyiaRouter", call: "PERMIT2()", expect: venues.permit2.address },
    ...venues.venues.map((v) => ({ contract: "ElyiaRouter", call: `venueKind(${v.address})`, expect: VENUE_KIND[v.kind] })),
    { contract: "ElyiaRouter", call: "protocolFeeBps()", expect: 0 },
    { contract: "ElyiaRouter", call: "paused()", expect: false },
    { contract: "ElyAccountFactory", call: "implementation()", expect: "nonzero" },
    { contract: "ElyOrders", call: "router()", expect: "$ElyiaRouter" },
  ],
  excludedVenues: venues.excluded,
  notes: [
    "Addresses come from packages/core/src/protocolData.ts and networks.ts; fork tests re-check code and getters at the pinned block.",
    "Elysium testnet supports Cancun opcodes (PUSH0, TSTORE, MCOPY checked by eth_call on 2026-11-01). Re-check on mainnet (chain 99901) before any mainnet deploy, and build a mainnet venue list: testnet venues do not exist there.",
    "Contract addresses follow the deployer's nonce (CREATE). The panel should compute and display them before each step.",
  ],
};

fs.mkdirSync(path.join(PKG, "deploy"), { recursive: true });
fs.writeFileSync(path.join(PKG, "deploy", "manifest.elysium-testnet.json"), JSON.stringify(manifest, null, 2) + "\n");

fs.mkdirSync(CORE_OUT, { recursive: true });
const header = (what) =>
  `// GENERATED by packages/contracts/scripts/export.cjs. Do not edit by hand.\n` +
  `// ${what}\n` +
  `// @elyia/contracts v${version}, sources ${srcHash}, solc ${compiler.solc}. NOT AUDITED.\n\n`;

const barrel = [];
for (const c of CONTRACTS) {
  const a = readArtifact(c.name);
  const constName = c.name.replace(/^./, (m) => m.toLowerCase()) + "Artifact";
  const body =
    header(`${c.name} ABI and bytecode.`) +
    `export const ${constName} = {\n` +
    `  contractName: ${JSON.stringify(c.name)},\n` +
    `  version: ${JSON.stringify(version)},\n` +
    `  sourceHash: ${JSON.stringify(srcHash)},\n` +
    `  compiler: ${JSON.stringify(compiler)},\n` +
    `  deployable: ${c.deployable},\n` +
    (c.note ? `  note: ${JSON.stringify(c.note)},\n` : "") +
    `  abi: ${JSON.stringify(a.abi, null, 2).replace(/\n/g, "\n  ")},\n` +
    `  bytecode: ${JSON.stringify(a.bytecode)},\n` +
    `  deployedBytecode: ${JSON.stringify(a.deployedBytecode)},\n` +
    `} as const;\n`;
  fs.writeFileSync(path.join(CORE_OUT, `${c.name}.ts`), body);
  barrel.push(`export { ${constName} } from "./${c.name}.js";`);
}

fs.writeFileSync(
  path.join(CORE_OUT, "manifest.ts"),
  header("Deployment manifest for Elysium testnet (order, constructor args, checks).") +
    `export const elysiumTestnetDeployManifest = ${JSON.stringify(manifest, null, 2)} as const;\n`,
);
barrel.push(`export { elysiumTestnetDeployManifest } from "./manifest.js";`);
barrel.push(`export const ELYIA_CONTRACTS_VERSION = ${JSON.stringify(version)};`);
barrel.push(`export const CONTRACTS_VERSION = ELYIA_CONTRACTS_VERSION;`);
fs.writeFileSync(path.join(CORE_OUT, "index.ts"), header("Barrel. Import from \"@elyia/core/contracts/index\".") + barrel.join("\n") + "\n");

console.log(`[export] manifest + ${CONTRACTS.length} artifacts -> ${path.relative(process.cwd(), CORE_OUT)} (v${version}, ${srcHash.slice(0, 12)}…)`);
