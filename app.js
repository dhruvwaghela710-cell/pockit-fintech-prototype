"use strict";

const SEPOLIA = "0xaa36a7";
const EXPLORER = "https://sepolia.etherscan.io";
const HISTORY_API = "https://eth-sepolia.blockscout.com/api/v2/addresses";

const businesses = {
  flowers: ["BloomPass", "EventEscrow"],
  garage: ["RepairEscrow", "ServicePassport"]
};

const contracts = {
  BloomPass: {
    address: "0xa2208d28ce723a0bd47a9de95e69bc4a44e2cd01",
    description: "The florist issues a flower delivery pass to the customer’s wallet.",
    primary: "issuePass",
    recipient: true,
    actions: {
      issuePass: "Issue a flower pass",
      redeemDelivery: "Record a delivery",
      creditBackDelivery: "Credit a delivery back",
      passes: "Check deliveries remaining",
      isActive: "Check whether the pass is active",
      ownerOf: "Check the pass owner",
      transferFrom: "Transfer a pass",
      tokenURI: "Read the pass metadata link"
    }
  },

  EventEscrow: {
    address: "0xe6fe643edc39735163c3e29618d6e26ce15a2a66",
    description: "The customer pays a deposit. EventEscrow holds it until the booking’s release conditions are met.",
    primary: "createBooking",
    deposit: true,
    actions: {
      createBooking: "Pay a flower booking deposit",
      bookings: "Check a booking",
      acceptBooking: "Accept the booking",
      cancelBooking: "Cancel the booking",
      markDelivered: "Mark the order delivered",
      confirmReceipt: "Confirm delivery and release payment",
      claimRefund: "Claim a refund"
    }
  },

  RepairEscrow: {
    address: "0xc8045f8005ea577f4294ba91a3326a5bb250b33c",
    description: "The customer funds a repair. RepairEscrow holds the deposit until the repair’s release conditions are met.",
    primary: "openJob",
    deposit: true,
    actions: {
      openJob: "Fund a repair job",
      jobs: "Check a repair job",
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
    description: "The garage registers a vehicle passport for the customer and adds service records.",
    primary: "registerVehicle",
    recipient: true,
    actions: {
      registerVehicle: "Register a vehicle passport",
      addServiceRecord: "Add a service record",
      recordCount: "Count service records",
      getRecord: "Read a service record",
      verifyVin: "Check a sample VIN",
      ownerOf: "Check the passport owner",
      tokenURI: "Read the passport metadata link"
    }
  }
};

const el = (id) => document.getElementById(id);
const businessSelect = el("business");
const contractSelect = el("contract");
const actionSelect = el("action");
const abis = new Map();
const history = new Map();

let announcedWallet;
let connectedWallet;
let account;
let busy = false;
let historyRequest;
let nextPage;
let primaryAction;

const currentContract = () => contracts[contractSelect.value];
const currentAbi = () => abis.get(contractSelect.value);

window.addEventListener("eip6963:announceProvider", (event) => {
  if (event.detail?.info?.rdns === "io.metamask") {
    announcedWallet = event.detail.provider;
  }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function setStatus(message) {
  el("status").textContent = message;
}

function showError(error) {
  const messages = {
    4001: "You declined the request in MetaMask.",
    4902: "Enable Sepolia in MetaMask and try again.",
    "-32002": "Open MetaMask to review the pending request.",
    ACTION_REJECTED: "You declined the request in MetaMask."
  };
  setStatus(messages[error.code] || error.shortMessage || error.message);
}

function ethereumLibrary() {
  if (!window.ethers) throw new Error("The Ethereum library didn’t load. Reload the page.");
  return window.ethers;
}

function setBusy(value) {
  busy = value;
  el("connect").disabled = value;
  businessSelect.disabled = value;
  contractSelect.disabled = value || !businessSelect.value;
  el("abi").disabled = value || !currentContract();
  actionSelect.disabled = value || !actionSelect.options.length;
  el("run").disabled = value || !actionSelect.value;
  el("quick-submit").disabled = value || !account || !primaryAction;
}

function updateAccount(address) {
  if (account === address) return;
  account = address;
  el("wallet").value = address || "";
  setBusy(busy);
  void loadHistory(true);
}

async function connectWallet() {
  const injected = window.ethereum;
  const wallet = announcedWallet ??
    injected?.providers?.find((provider) => provider.isMetaMask) ??
    (injected?.isMetaMask ? injected : null);

  if (!wallet) {
    throw new Error("Open Pockit in the browser profile where MetaMask is installed.");
  }

  let addresses = await wallet.request({ method: "eth_accounts" });
  if (!addresses.length) {
    addresses = await wallet.request({ method: "eth_requestAccounts" });
  }
  if (!addresses.length) throw new Error("Choose an account in MetaMask.");

  if (await wallet.request({ method: "eth_chainId" }) !== SEPOLIA) {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA }]
    });
  }

  const [address] = await wallet.request({ method: "eth_accounts" });
  if (!address) throw new Error("Unlock MetaMask and select an account.");

  if (connectedWallet !== wallet) {
    connectedWallet?.removeListener?.("accountsChanged", onAccountsChanged);
    connectedWallet = wallet;
    wallet.on?.("accountsChanged", onAccountsChanged);
  }

  updateAccount(address);
  return { wallet, address };
}

function onAccountsChanged(addresses) {
  updateAccount(addresses[0]);
}

function addField(container, name, text, required = true) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.textContent = text;
  input.name = name;
  input.required = required;
  input.autocomplete = "off";
  input.spellcheck = false;
  label.append(input);
  container.append(label);
  return input;
}

function drawFields(container, fragment, showRecipient = false) {
  container.replaceChildren();
  if (!fragment) return;

  const addressInputs = fragment.inputs
    .map((parameter, index) => ({ parameter, index }))
    .filter(({ parameter }) => parameter.type === "address");

  // Use the customer label only when the ABI has one unambiguous address field.
  const recipientIndex = showRecipient && addressInputs.length === 1
    ? addressInputs[0].index
    : -1;

  fragment.inputs.forEach((parameter, index) => {
    if (index === recipientIndex) return;
    const label = parameter.name || `Input ${index + 1}`;
    const input = addField(
      container, `arg${index}`, `${label} (${parameter.type})`,
      parameter.type !== "string"
    );
    if (fragment.name === "jobs" && index === 0) input.value = "1";
    if (["array", "tuple"].includes(parameter.baseType)) {
      input.placeholder = "Enter a JSON array";
    }
  });

  if (recipientIndex >= 0) {
    addField(container, `arg${recipientIndex}`, "👛 Customer wallet address")
      .placeholder = "0x…";
  }

  if (fragment.payable) {
    const amount = addField(container, "amount", "Amount in Sepolia test ETH");
    amount.inputMode = "decimal";
    amount.placeholder = fragment.name === "createBooking" ? "0.001" : "0.01";
  }
}

function renderOtherAction() {
  const fragment = actionSelect.value
    ? currentAbi()?.getFunction(actionSelect.value)
    : null;
  drawFields(el("action-fields"), fragment);
  el("run").textContent = fragment?.constant ? "Read result" : "Review in MetaMask";
  setBusy(busy);
}

function renderContract() {
  const config = currentContract();
  const abi = currentAbi();
  const actions = abi?.fragments.filter((entry) =>
    entry.type === "function" && Object.hasOwn(config.actions, entry.name)
  ) ?? [];

  const candidates = actions.filter((entry) =>
    entry.name === config.primary && !entry.constant &&
    (!config.deposit || entry.payable)
  );
  primaryAction = candidates.length === 1 ? candidates[0] : null;

  el("description").textContent = config?.description || "";
  el("contract-address").textContent = config ? `Sepolia contract: ${config.address}` : "";
  el("contract-setup").hidden = !config;
  el("quick-form").hidden = !primaryAction;
  el("other-actions").hidden = !actions.length;

  if (!abi) {
    el("abi-status").textContent = config
      ? `Upload the ABI exported from Remix for ${contractSelect.value}.`
      : "";
  } else if (!primaryAction) {
    el("abi-status").textContent =
      `ABI loaded. No single matching ${config.primary} action was found for the main button.`;
  } else {
    el("abi-status").textContent = "ABI loaded. Fill in the fields below.";
  }

  el("quick-submit").textContent = config?.deposit
    ? "Pay with MetaMask"
    : "Review in MetaMask";

  drawFields(el("quick-fields"), primaryAction, config?.recipient);
  actionSelect.replaceChildren(...actions.map((entry) =>
    new Option(config.actions[entry.name], entry.format("sighash"))
  ));
  renderOtherAction();
}

function parseInput(parameter, value, ethers) {
  if (parameter.type === "address") {
    const address = value.trim();
    if (!ethers.isAddress(address) || address.toLowerCase() === ethers.ZeroAddress) {
      throw new Error("Enter a valid, non-zero wallet address starting with 0x.");
    }
    return ethers.getAddress(address);
  }

  if (["array", "tuple"].includes(parameter.baseType)) return JSON.parse(value);

  if (parameter.type === "bool") {
    const text = value.trim();
    if (text === "true") return true;
    if (text === "false") return false;
    throw new Error("Enter true or false for the Boolean field.");
  }

  return parameter.type === "string" ? value : value.trim();
}

function clearResult() {
  el("result").hidden = true;
  el("result").textContent = "";
  el("receipt").hidden = true;
  el("receipt").removeAttribute("href");
}

function displayResult(lines) {
  el("result").textContent = lines.join("\n");
  el("result").hidden = false;
}

async function runAction(event, fragment) {
  event.preventDefault();
  if (busy || !fragment) return;

  const config = currentContract();
  const abi = currentAbi();
  const fields = new FormData(event.currentTarget);
  const expectedAccount = account;

  setBusy(true);
  clearResult();

  try {
    const ethers = ethereumLibrary();
    const args = fragment.inputs.map((parameter, index) =>
      parseInput(parameter, fields.get(`arg${index}`), ethers)
    );

    const overrides = {};
    if (fragment.payable) {
      const amount = fields.get("amount").trim();
      if (!/^(?:\d+(?:\.\d{1,18})?|\.\d{1,18})$/.test(amount)) {
        throw new Error("Enter a Sepolia test ETH amount, such as 0.001.");
      }
      overrides.value = ethers.parseEther(amount);
      if (config.deposit && fragment.name === config.primary && overrides.value <= 0n) {
        throw new Error("Enter a deposit greater than zero.");
      }
    }

    const { wallet, address } = await connectWallet();
    if (expectedAccount && expectedAccount.toLowerCase() !== address.toLowerCase()) {
      throw new Error("Your MetaMask account changed. Check the wallet address and try again.");
    }

    const provider = new ethers.BrowserProvider(wallet);
    if ((await provider.getNetwork()).chainId !== 11155111n) {
      throw new Error("Switch MetaMask to Sepolia before continuing.");
    }
    if (await provider.getCode(config.address) === "0x") {
      throw new Error("No deployed contract was found at this address on Sepolia.");
    }

    const runner = fragment.constant ? provider : await provider.getSigner(address);
    const contract = new ethers.Contract(config.address, abi, runner);
    const method = contract.getFunction(fragment.format("sighash"));

    if (fragment.constant) {
      const values = await method.staticCallResult(...args);
      displayResult(fragment.outputs.map((output, index) => {
        const value = JSON.stringify(values[index], (_, item) =>
          typeof item === "bigint" ? item.toString() : item
        );
        return `${output.name || `Result ${index + 1}`}: ${value}`;
      }));
      setStatus("Result read from Sepolia.");
      return;
    }

    setStatus("Review the prepared transaction in MetaMask.");
    const tx = await method.send(...args, overrides);

    const details = [
      `Action: ${config.actions[fragment.name]}`,
      `Sending wallet: ${tx.from}`,
      `Contract: ${config.address}`,
      `Test ETH sent: ${ethers.formatEther(tx.value)}`,
      `Transaction hash: ${tx.hash}`
    ];
    displayResult(details);
    el("receipt").href = `${EXPLORER}/tx/${tx.hash}`;
    el("receipt").hidden = false;
    setStatus("Submitted. Waiting for Sepolia confirmation…");

    const receipt = await tx.wait(1, 120000);
    if (receipt?.status !== 1) {
      setStatus("Check the receipt for the final transaction status.");
      return;
    }

    details.push(`Block: ${receipt.blockNumber}`);
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.address) continue;
      try {
        const decoded = abi.parseLog(log);
        if (!decoded) continue;
        const values = decoded.fragment.inputs.map((input, index) =>
          `${input.name || `Value ${index + 1}`}: ${String(decoded.args[index])}`
        );
        details.push(`${decoded.name} — ${values.join(", ")}`);
      } catch {
        // Logs outside the loaded ABI can still be viewed in the receipt.
      }
    }

    displayResult(details);
    setStatus("Confirmed on Sepolia. Use Refresh history if the new record takes time to appear.");
    void loadHistory(true);
  } catch (error) {
    if (error.code === "TIMEOUT" && !el("receipt").hidden) {
      setStatus("Transaction submitted. Open the receipt to check confirmation.");
    } else {
      showError(error);
    }
  } finally {
    setBusy(false);
  }
}

function formatTestEth(wei) {
  const digits = BigInt(wei ?? "0").toString().padStart(19, "0");
  const fraction = digits.slice(-18).replace(/0+$/, "");
  return digits.slice(0, -18) + (fraction ? `.${fraction}` : "");
}

function renderHistory() {
  const body = el("history-rows");
  const config = currentContract();
  body.replaceChildren();

  for (const tx of history.values()) {
    const row = body.insertRow();
    const action = Object.hasOwn(config.actions, tx.method)
      ? config.actions[tx.method]
      : tx.method || (tx.created_contract ? "Deploy contract" : "Contract transaction");
    const sender = tx.from?.hash;
    const status = tx.status === "ok" ? "Success"
      : tx.status === "error" ? "Failed"
      : tx.timestamp ? "Unknown" : "Pending";

    for (const value of [
      action,
      tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "Pending",
      sender ? `${sender.slice(0, 8)}…${sender.slice(-4)}` : "—",
      formatTestEth(tx.value),
      status
    ]) {
      row.insertCell().textContent = value;
    }
    row.cells[2].title = sender || "";

    const receiptCell = row.insertCell();
    if (typeof tx.hash === "string" && /^0x[0-9a-f]{64}$/i.test(tx.hash)) {
      const link = document.createElement("a");
      link.href = `${EXPLORER}/tx/${tx.hash}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${tx.hash.slice(0, 10)}…`;
      receiptCell.append(link);
    }
  }
}

async function loadHistory(reset) {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;

  if (reset) {
    history.clear();
    nextPage = null;
    renderHistory();
  }

  const config = currentContract();
  const status = el("history-status");
  const more = el("history-more");
  const showAll = el("history-all").checked;
  const walletFilter = account?.toLowerCase();
  more.hidden = true;
  more.disabled = true;

  if (!config) {
    status.textContent = "Choose a business and contract to view its history.";
    return;
  }
  if (!showAll && !walletFilter) {
    status.textContent = "Connect MetaMask to filter by your wallet, or tick Show all wallets.";
    return;
  }

  status.textContent = "Loading Sepolia history…";
  const url = new URL(`${HISTORY_API}/${config.address}/transactions`);
  if (nextPage) url.search = new URLSearchParams(nextPage).toString();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: "omit"
    });
    if (!response.ok) throw new Error(`History service returned HTTP ${response.status}.`);

    const data = await response.json();
    if (controller.signal.aborted) return;
    if (!Array.isArray(data.items)) throw new Error("Unexpected history response.");

    nextPage = data.next_page_params ?? null;
    for (const tx of data.items) {
      const addresses = [tx.from?.hash, tx.to?.hash, tx.created_contract?.hash];
      if (showAll || addresses.some((address) => address?.toLowerCase() === walletFilter)) {
        history.set(tx.hash, tx);
      }
    }

    renderHistory();
    status.textContent = history.size
      ? `${history.size} matching transaction(s) shown.`
      : nextPage ? "No matches on this page. Click Load older transactions."
      : "No matching transactions found.";
  } catch (error) {
    if (!controller.signal.aborted) {
      status.textContent = `Could not load history. ${error.message} Try Refresh history.`;
    }
  } finally {
    if (!controller.signal.aborted) {
      more.hidden = !nextPage;
      more.disabled = !nextPage;
    }
  }
}

function selectionChanged() {
  el("abi").value = "";
  clearResult();
  renderContract();
  setStatus(currentContract() ? "Contract selected." : "Choose a business and contract.");
  void loadHistory(true);
}

businessSelect.addEventListener("change", () => {
  const names = businesses[businessSelect.value] || [];
  contractSelect.replaceChildren(
    new Option(names.length ? "Select a contract" : "Select a business first", ""),
    ...names.map((name) => new Option(name, name))
  );
  selectionChanged();
});

contractSelect.addEventListener("change", selectionChanged);

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

el("abi").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  const name = contractSelect.value;
  if (!file || !name || busy) return;
  setBusy(true);

  try {
    const ethers = ethereumLibrary();
    const parsed = JSON.parse(await file.text());
    const entries = Array.isArray(parsed) ? parsed : parsed?.abi;
    if (!Array.isArray(entries)) throw new Error("Upload the ABI JSON exported from Remix.");

    const abi = new ethers.Interface(entries);
    const valid = abi.fragments.some((entry) =>
      entry.type === "function" && Object.hasOwn(contracts[name].actions, entry.name)
    );
    if (!valid) throw new Error(`This ABI contains no supported actions for ${name}.`);

    abis.set(name, abi);
    renderContract();
  } catch (error) {
    abis.delete(name);
    el("abi").value = "";
    renderContract();
    el("abi-status").textContent = error.message;
  } finally {
    setBusy(false);
  }
});

actionSelect.addEventListener("change", renderOtherAction);
el("quick-form").addEventListener("submit", (event) => {
  void runAction(event, primaryAction);
});
el("action-form").addEventListener("submit", (event) => {
  const fragment = actionSelect.value
    ? currentAbi()?.getFunction(actionSelect.value)
    : null;
  void runAction(event, fragment);
});

el("history-refresh").addEventListener("click", () => loadHistory(true));
el("history-all").addEventListener("change", () => loadHistory(true));
el("history-more").addEventListener("click", () => loadHistory(false));

renderContract();
void loadHistory(true);
