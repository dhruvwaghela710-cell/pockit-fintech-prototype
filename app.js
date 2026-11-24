"use strict";

// Change true to false to hide the ABI upload, action button, and action result.
const ENABLE_ACTIONS = true;

const SEPOLIA = "0xaa36a7";
const EXPLORER = "https://sepolia.etherscan.io";
const HISTORY_API = "https://eth-sepolia.blockscout.com/api/v2/addresses";

const contracts = {
  RepairEscrow: {
    address: "0xc8045f8005ea577f4294ba91a3326a5bb250b33c",
    description: "The customer funds a repair, the garage completes it, and the customer approves payment.",
    actions: {
      jobs: "Check a repair job",
      openJob: "Fund a new repair job",
      startJob: "Start the repair",
      completeJob: "Mark repair complete",
      approveCompletion: "Approve completion and release payment",
      requestExtraWork: "Request extra work",
      approveExtra: "Approve extra work",
      raiseDispute: "Raise a dispute",
      resolveDispute: "Resolve a dispute"
    }
  },

  ServicePassport: {
    address: "0x46db0219446508cca536903cbfc6180e2162668b",
    description: "The garage registers a vehicle and records its service history.",
    actions: {
      registerVehicle: "Register a vehicle",
      addServiceRecord: "Add a service record",
      recordCount: "Count service records",
      getRecord: "Read a service record",
      verifyVin: "Check a sample VIN",
      ownerOf: "Check the passport owner",
      tokenURI: "Read the passport metadata link"
    }
  },

  BloomPass: {
    address: "0xa2208d28ce723a0bd47a9de95e69bc4a44e2cd01",
    description: "The florist issues a prepaid flower pass and records how many deliveries remain.",
    actions: {
      issuePass: "Issue a flower pass",
      redeemDelivery: "Record a delivery",
      creditBackDelivery: "Credit a delivery back",
      passes: "Check deliveries remaining",
      isActive: "Check if the pass is active",
      ownerOf: "Check the pass owner",
      transferFrom: "Transfer a pass",
      tokenURI: "Read the pass metadata link"
    }
  },

  EventEscrow: {
    address: "0xe6fe643edc39735163c3e29618d6e26ce15a2a66",
    description: "The customer funds a booking, the florist delivers, and the customer confirms receipt.",
    actions: {
      bookings: "Check a booking",
      createBooking: "Pay a booking deposit",
      acceptBooking: "Accept the booking",
      cancelBooking: "Cancel the booking",
      markDelivered: "Mark the order delivered",
      confirmReceipt: "Confirm receipt and release payment",
      claimRefund: "Claim a refund"
    }
  }
};

const el = (id) => document.getElementById(id);
const contractSelect = el("contract");
const actionSelect = el("action");
const selectedContract = () => contracts[contractSelect.value];

const loadedAbis = new Map();
const historyRows = new Map();

let announcedMetaMask;
let connectedWallet;
let walletAddress;
let historyRequest;
let nextHistoryPage = null;
let busy = false;

window.addEventListener("eip6963:announceProvider", (event) => {
  if (event.detail?.info?.rdns === "io.metamask") {
    announcedMetaMask = event.detail.provider;
  }
});

window.dispatchEvent(new Event("eip6963:requestProvider"));

function setStatus(message) {
  el("status").textContent = message;
}

function showError(error) {
  const messages = {
    4001: "You declined the MetaMask request.",
    4902: "Enable Sepolia in MetaMask and try again.",
    "-32002": "Open MetaMask and review the pending request.",
    ACTION_REJECTED: "You declined the MetaMask request."
  };

  setStatus(
    messages[error.code] ||
    error.shortMessage ||
    error.message ||
    "The request failed."
  );
}

function ethereumLibrary() {
  if (!window.ethers) {
    throw new Error("The ethers library did not load. Check your internet connection and reload.");
  }
  return window.ethers;
}

function setBusy(value) {
  busy = value;
  el("connect").disabled = value;
  contractSelect.disabled = value;
  el("abi").disabled = value;

  const actionDisabled = value || !ENABLE_ACTIONS || !actionSelect.options.length;
  actionSelect.disabled = actionDisabled;
  el("run").disabled = actionDisabled;
}

function updateWallet(address) {
  walletAddress = address?.toLowerCase();
  el("wallet").textContent = address
    ? "Connected wallet: " + address
    : "Wallet disconnected";
  void loadHistory(true);
}

async function connectWallet() {
  const injected = window.ethereum;
  const wallet =
    announcedMetaMask ??
    injected?.providers?.find((provider) => provider.isMetaMask) ??
    (injected?.isMetaMask ? injected : undefined);

  if (!wallet) {
    throw new Error("Open the live website in the browser profile where MetaMask is installed.");
  }

  let accounts = await wallet.request({ method: "eth_accounts" });

  if (!accounts.length) {
    accounts = await wallet.request({ method: "eth_requestAccounts" });
  }

  if (!accounts.length) {
    throw new Error("Select an account in MetaMask.");
  }

  if (await wallet.request({ method: "eth_chainId" }) !== SEPOLIA) {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA }]
    });
  }

  const [account] = await wallet.request({ method: "eth_accounts" });

  if (!account) {
    throw new Error("Unlock MetaMask and select an account on Sepolia.");
  }

  if (connectedWallet !== wallet) {
    connectedWallet = wallet;
    wallet.on?.("accountsChanged", (addresses) => {
      updateWallet(addresses[0]);
    });
  }

  if (walletAddress !== account.toLowerCase()) {
    updateWallet(account);
  }

  return { wallet, account };
}

function formatTestEth(wei) {
  const digits = BigInt(wei ?? "0").toString().padStart(19, "0");
  const whole = digits.slice(0, -18);
  const fraction = digits.slice(-18).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

function shortAddress(address) {
  return address ? `${address.slice(0, 8)}…${address.slice(-4)}` : "—";
}

function renderHistory() {
  const body = el("history-rows");
  const contract = selectedContract();
  body.replaceChildren();

  for (const transaction of historyRows.values()) {
    const row = body.insertRow();
    const method = transaction.method;
    const action = Object.hasOwn(contract.actions, method)
      ? contract.actions[method]
      : method || (transaction.created_contract ? "Deploy contract" : "Contract transaction");

    const date = transaction.timestamp
      ? new Date(transaction.timestamp).toLocaleString()
      : "Pending";

    let status = "Pending";
    if (transaction.status === "ok") status = "Success";
    if (transaction.status === "error") status = "Failed";

    const sender = transaction.from?.hash;
    row.insertCell().textContent = action;
    row.insertCell().textContent = date;

    const senderCell = row.insertCell();
    senderCell.textContent = shortAddress(sender);
    senderCell.title = sender || "";

    row.insertCell().textContent = formatTestEth(transaction.value);
    row.insertCell().textContent = status;

    const receiptCell = row.insertCell();
    const hash = transaction.hash;

    if (typeof hash === "string" && /^0x[0-9a-f]{64}$/i.test(hash)) {
      const link = document.createElement("a");
      link.href = `${EXPLORER}/tx/${hash}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = shortAddress(hash);
      link.title = hash;
      receiptCell.append(link);
    }
  }
}

async function loadHistory(reset) {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;

  if (reset) {
    nextHistoryPage = null;
    historyRows.clear();
    renderHistory();
  }

  const status = el("history-status");
  const more = el("history-more");
  const showAll = el("history-all").checked;
  const wallet = walletAddress;
  const address = selectedContract().address;

  more.disabled = true;
  more.hidden = true;

  if (!showAll && !wallet) {
    status.textContent =
      "Connect MetaMask to see your wallet’s transactions, or tick Show all wallets.";
    return;
  }

  status.textContent = "Loading Sepolia transactions…";

  const url = new URL(`${HISTORY_API}/${address}/transactions`);

  if (nextHistoryPage) {
    url.search = new URLSearchParams(nextHistoryPage).toString();
  }

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit"
    });

    if (!response.ok) {
      throw new Error(`History service returned HTTP ${response.status}.`);
    }

    const data = await response.json();
    if (controller.signal.aborted) return;

    if (!Array.isArray(data.items)) {
      throw new Error("The history service returned an unexpected response.");
    }

    nextHistoryPage = data.next_page_params ?? null;

    for (const transaction of data.items) {
      const addresses = [
        transaction.from?.hash,
        transaction.to?.hash,
        transaction.created_contract?.hash
      ];

      if (showAll || addresses.some((item) => item?.toLowerCase() === wallet)) {
        historyRows.set(transaction.hash, transaction);
      }
    }

    renderHistory();

    if (historyRows.size) {
      status.textContent = `${historyRows.size} matching transaction(s) shown.`;
    } else if (nextHistoryPage) {
      status.textContent = "No matches on this page. Try Load older transactions.";
    } else {
      status.textContent = "No matching transactions found.";
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      status.textContent = `Could not load history. ${error.message} Try Refresh history.`;
    }
  } finally {
    if (!controller.signal.aborted) {
      more.hidden = !nextHistoryPage;
      more.disabled = !nextHistoryPage;
    }
  }
}

function clearResult() {
  el("result").textContent = "";
  el("receipt").hidden = true;
  el("receipt").removeAttribute("href");
}

function currentAbi() {
  return loadedAbis.get(contractSelect.value);
}

function renderContract() {
  const contract = selectedContract();
  const abi = currentAbi();

  el("description").textContent = contract.description;

  const actions = abi?.fragments.filter((fragment) =>
    fragment.type === "function" &&
    Object.hasOwn(contract.actions, fragment.name)
  ) ?? [];

  actionSelect.replaceChildren(...actions.map((fragment) =>
    new Option(
      `${contract.actions[fragment.name]} (${fragment.name})`,
      fragment.format("sighash")
    )
  ));

  el("abi-status").textContent = actions.length
    ? "ABI loaded. Choose an action."
    : "Load the ABI for the selected contract to run an action.";

  renderFields();
  setBusy(busy);
}

function addField(name, text, required = true) {
  const label = document.createElement("label");
  const input = document.createElement("input");

  label.textContent = text;
  input.name = name;
  input.required = required;
  input.autocomplete = "off";

  label.append(input);
  el("fields").append(label);
  return input;
}

function renderFields() {
  el("fields").replaceChildren();
  el("run").textContent = "Run action";

  if (!actionSelect.value) return;

  const fragment = currentAbi().getFunction(actionSelect.value);

  fragment.inputs.forEach((parameter, index) => {
    const name = parameter.name || `Input ${index + 1}`;
    const input = addField(
      `arg${index}`,
      `${name} (${parameter.type})`,
      parameter.type !== "string"
    );

    if (fragment.name === "jobs" && index === 0) input.value = "1";

    if (parameter.baseType === "array" || parameter.baseType === "tuple") {
      input.placeholder = "Enter a JSON array";
    }
  });

  if (fragment.payable) {
    const amount = addField("eth", "Amount in Sepolia test ETH");
    amount.inputMode = "decimal";
    amount.placeholder = "0.01";
  }

  el("run").textContent = fragment.constant ? "Read result" : "Review in MetaMask";
}

function parseInput(parameter, value) {
  if (parameter.baseType === "array" || parameter.baseType === "tuple") {
    return JSON.parse(value);
  }

  if (parameter.type === "bool") {
    const text = value.trim();
    if (text === "true") return true;
    if (text === "false") return false;
    throw new Error("Enter true or false for the boolean input.");
  }

  return parameter.type === "string" ? value : value.trim();
}

function describeEvents(receipt, abi, address) {
  const events = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;

    try {
      const event = abi.parseLog(log);
      if (!event) continue;

      const fields = event.fragment.inputs.map((input, index) =>
        `${input.name || `Value ${index + 1}`}: ${String(event.args[index])}`
      );

      events.push(`${event.name}: ${fields.join(", ")}`);
    } catch {
      // The ABI may omit some event definitions.
    }
  }

  return events;
}

el("connect").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);

  try {
    await connectWallet();
    setStatus("MetaMask connected on Sepolia.");
  } catch (error) {
    showError(error);
  } finally {
    setBusy(false);
  }
});

contractSelect.addEventListener("change", () => {
  el("abi").value = "";
  clearResult();
  renderContract();
  void loadHistory(true);
});

el("history-refresh").addEventListener("click", () => loadHistory(true));
el("history-all").addEventListener("change", () => loadHistory(true));
el("history-more").addEventListener("click", () => loadHistory(false));

el("abi").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  if (!ENABLE_ACTIONS || busy || !file) return;

  const name = contractSelect.value;
  setBusy(true);
  clearResult();

  try {
    const ethers = ethereumLibrary();
    const parsed = JSON.parse(await file.text());
    const entries = Array.isArray(parsed) ? parsed : parsed?.abi;

    if (!Array.isArray(entries)) {
      throw new Error("Choose the ABI JSON copied from Remix.");
    }

    const abi = new ethers.Interface(entries);
    const supported = abi.fragments.some((fragment) =>
      fragment.type === "function" &&
      Object.hasOwn(contracts[name].actions, fragment.name)
    );

    if (!supported) {
      throw new Error(`This ABI contains no supported actions for ${name}.`);
    }

    loadedAbis.set(name, abi);
    renderContract();
  } catch (error) {
    loadedAbis.delete(name);
    renderContract();
    el("abi").value = "";
    el("abi-status").textContent = error.message;
  } finally {
    setBusy(false);
  }
});

actionSelect.addEventListener("change", renderFields);

el("action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!ENABLE_ACTIONS || busy || !actionSelect.value) return;

  const fields = new FormData(event.currentTarget);
  const config = selectedContract();
  const abi = currentAbi();
  const signature = actionSelect.value;

  setBusy(true);
  clearResult();

  try {
    const ethers = ethereumLibrary();
    const fragment = abi.getFunction(signature);
    const args = fragment.inputs.map((input, index) =>
      parseInput(input, fields.get(`arg${index}`))
    );

    const overrides = {};

    if (fragment.payable) {
      const amount = fields.get("eth").trim();
      if (!/^(?:\d+(?:\.\d{1,18})?|\.\d{1,18})$/.test(amount)) {
        throw new Error("Enter a test ETH amount such as 0.01.");
      }
      overrides.value = ethers.parseEther(amount);
    }

    const { wallet, account } = await connectWallet();
    const provider = new ethers.BrowserProvider(wallet);

    if ((await provider.getNetwork()).chainId !== 11155111n) {
      throw new Error("Switch MetaMask to Sepolia before running the action.");
    }

    if (await provider.getCode(config.address) === "0x") {
      throw new Error("No deployed contract was found at this address on Sepolia.");
    }

    const runner = fragment.constant
      ? provider
      : await provider.getSigner(account);

    const method = new ethers.Contract(config.address, abi, runner)
      .getFunction(signature);

    if (fragment.constant) {
      const values = await method.staticCallResult(...args);

      el("result").textContent = fragment.outputs.map((output, index) => {
        const value = JSON.stringify(values[index], (_, item) =>
          typeof item === "bigint" ? item.toString() : item
        );
        return `${output.name || `Result ${index + 1}`}: ${value}`;
      }).join("\n");

      setStatus("Result read from Sepolia.");
      return;
    }

    setStatus("Review the transaction in MetaMask.");
    const transaction = await method.send(...args, overrides);

    const details = [
      `Action: ${config.actions[fragment.name]}`,
      `From: ${transaction.from}`,
      `Contract: ${config.address}`,
      `Test ETH sent: ${ethers.formatEther(transaction.value)}`,
      `Transaction hash: ${transaction.hash}`
    ];

    el("result").textContent = details.join("\n");
    el("receipt").href = `${EXPLORER}/tx/${transaction.hash}`;
    el("receipt").hidden = false;
    setStatus("Submitted. Waiting for Sepolia confirmation…");

    const receipt = await transaction.wait(1, 120000);

    if (!receipt || receipt.status !== 1) {
      setStatus("Check the receipt for the final transaction status.");
      return;
    }

    details.push(`Block: ${receipt.blockNumber}`);
    details.push(...describeEvents(receipt, abi, config.address));
    el("result").textContent = details.join("\n");

    setStatus("Confirmed on Sepolia. If history has not updated yet, click Refresh history.");
    void loadHistory(true);
  } catch (error) {
    if (error.code === "TIMEOUT" && !el("receipt").hidden) {
      setStatus("Transaction submitted. Check the receipt for its latest status.");
    } else {
      showError(error);
    }
  } finally {
    setBusy(false);
  }
});

contractSelect.replaceChildren(
  ...Object.keys(contracts).map((name) => new Option(name, name))
);

el("action-panel").hidden = !ENABLE_ACTIONS;
el("result-panel").hidden = !ENABLE_ACTIONS;

renderContract();
void loadHistory(true);
