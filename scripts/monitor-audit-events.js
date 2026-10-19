// Example: Monitor audit events from all Hunty contracts
//
// Usage:
//   NETWORK=testnet node scripts/monitor-audit-events.js
//   NETWORK=mainnet node scripts/monitor-audit-events.js
//
// The contract id is read from config/contracts.<network>.json (key: core).
// Polls Soroban RPC via @stellar/stellar-sdk rpc.Server.getEvents.
const fs = require('fs');
const path = require('path');
const { rpc, scValToNative } = require('@stellar/stellar-sdk');

const NETWORK = process.env.NETWORK || 'testnet';
const RPC_URL = process.env.RPC_URL || (NETWORK === 'mainnet'
  ? 'https://soroban-mainnet.stellar.org'
  : 'https://soroban-testnet.stellar.org');
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 5000);

function loadContractId(network) {
  const configPath = path.join(__dirname, '..', 'config', `contracts.${network}.json`);
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  const contractId = config.core || config.coreContractId || config.contractId;
  if (!contractId) {
    throw new Error(`No core contract id found in ${configPath}`);
  }
  return contractId;
}

function handleAuditEvent(event) {
  let auditData;
  try {
    auditData = scValToNative(event.value);
  } catch (err) {
    console.warn(`[AUDIT] Could not decode event ${event.id}: ${err.message}`);
    return;
  }

  const actionType = auditData.action_type || auditData.actionType || 'UNKNOWN';
  const admin = auditData.admin_address || auditData.adminAddress || 'unknown';
  const timestamp = auditData.timestamp ? new Date(auditData.timestamp * 1000) : new Date();

  console.log(`[AUDIT] ${actionType} by ${admin} at ${timestamp.toISOString()}`);

  if (actionType === 'EMERGENCY') {
    console.warn(`[SECURITY ALERT] Emergency action detected: ${JSON.stringify(auditData)}`);
  }

  if (actionType.startsWith('ADM_')) {
    console.log(`[ADMIN CHANGE] ${JSON.stringify(auditData)}`);
  }
}

async function main() {
  const contractId = loadContractId(NETWORK);
  const server = new rpc.Server(RPC_URL);

  console.log(`Monitoring audit events for ${contractId} on ${NETWORK} (${RPC_URL})`);

  let cursor = 'now';
  let running = true;

  const shutdown = () => {
    running = false;
    console.log('Stopping audit event monitor...');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      const response = await server.getEvents({
        startCursor: cursor,
        filters: [
          {
            type: 'contract',
            contractIds: [contractId],
            topics: [['AUDIT']],
          },
        ],
        limit: 100,
      });

      for (const event of response.events || []) {
        handleAuditEvent(event);
      }

      if (response.cursor) {
        cursor = response.cursor;
      }
    } catch (err) {
      console.error(`Failed to fetch audit events: ${err.message}`);
    }

    if (running) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
