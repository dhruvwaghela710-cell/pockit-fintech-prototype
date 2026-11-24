"use strict";

const SEPOLIA = "0xaa36a7";
const SEPOLIA_CHAIN_ID = 11155111n;
const EXPLORER = "https://sepolia.etherscan.io";
const HISTORY_API = "https://eth-sepolia.blockscout.com/api/v2/addresses";

const businesses = {
  flowers: ["BloomPass", "EventEscrow"],
  garage: ["RepairEscrow", "ServicePassport"]
};

const contracts = {
  BloomPass: {
    address: "0xa2208d28ce723a0bd47a9de95e69bc4a44e2cd01",
    description: "Issue a flower delivery pass and track the customer’s remaining deliveries.",
    actions: {
      issuePass: "Issue a flower pass",
      redeemDelivery: "Record a delivery",
      creditBackDelivery: "Credit a delivery back",
      passes: "Check deliveries remaining",
      isActive: "Check whether a pass is active",
      ownerOf: "Check the pass owner",
      transferFrom: "Transfer a pass",
      tokenURI: "Read the pass metadata link"
    }
  },
  EventEscrow: {
    address: "0xe6fe643edc39735163c3e29618d6e26ce15a2a66",
    description: "Hold a flower booking deposit until the contract’s release conditions are met.",
    actions: {
      createBooking: "Pay a flower booking deposit",
      bookings: "Check a booking",
      acceptBooking: "Accept the booking",
      cancelBooking: "Cancel the booking",
      markDelivered: "Mark the order delivered",
      confirmReceipt: "Confirm receipt and release payment",
      claimRefund: "Claim a refund"
    }
  },
  RepairEscrow: {
    address: "0xc8045f8005ea577f4294ba91a3326a5bb250b33c",
    description: "Fund a repair and release the deposit when the customer approves completion.",
    actions: {
      openJob: "Fund a repair job",
      jobs: "Check a repair job",
      startJob: "Start the repair",
      completeJob: "Mark the repair complete",
      approveCompletion: "Approve completion and release payment",
      requestExtraWork: "Request extra work",
      approveExtra: "Approve extra work",
      raiseDispute: "Raise a dispute",
      resolveDispute: "Resolve a dispute"
    }
  },
  ServicePassport: {
    address: "0x46db0219446508cca536903cbfc6180e2162668b",
    description: "Register a vehicle passport and record its service history.",
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
const transactions = new Map();

let announcedWallet;
let connectedWallet;
let account;
let busy = false;
let historyRequest;
let nextPage = null;

const selectedContract = () => contracts[contractSelect.value];
const selectedAbi = () => abis.get(contractSelect.value);

window.addEventListener("eip6963:announceProvider", (event) => {
  if (event.detail?.info?.rdns === "io.metamask") {
    announcedWallet = event.detail.provider;
  }
});
window.dispatchEvent(new Event("eip6963:requestProvider"));

function ethereumLibrary() {
  if (!window.ethers) {
    throw new Error("The ethers library could not load. Reload the page.");
  }
  return window.ethers;
}

function errorMessage(error) {
  const messages = {
    4001: "You cancelled the request in MetaMask.",
    4902: "Enable Sepolia in MetaMask and try again.",
    "-32002": "Open MetaMask to review the pending request.",
    ACTION_REJECTED: "You cancelled the request in MetaMask."
  };
  return messages[error.code] || error.shortMessage || error.message || "The request failed.";
}

function setBusy(value) {
  busy = value;
  el("connect").disabled = value;
  businessSelect.disabled = value;
  contractSelect.disabled = value || !businessSelect.value;
  el("abi").disabled = value || !selectedContract();
  actionSelect.disabled = value || !actionSelect.options.length;
  el("run").disabled = value || !actionSelect.value;
  el("pay").disabled = value || !selectedContract();
}

function updateAccount(address) {
  el("wallet").value = address || "";
  if (account === address) return;
  account = address;
  void loadHistory(true);
}

function onAccountsChanged(addresses) {
  updateAccount(addresses[0]);
  el("wallet-status").textContent = addresses.length
    ? "Sending wallet updated."
    : "Wallet disconnected.";
}

async function connectWallet() {
  const injected = window.ethereum;
  const wallet = announcedWallet ??
    injected?.providers?.find((item) => item.isMetaMask) ??
    (injected?.isMetaMask ? injected : null);

  if (!wallet) {
    throw new Error("Open Pockit in the browser profile where MetaMask is installed.");
  }

  let addresses = await wallet.request({ method: "eth_accounts" });
  if (!addresses.length) {
    addresses = await wallet.request({ method: "eth_requestAccounts" });
  }
  if (!addresses.length) throw new Error("Select an account in MetaMask.");

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

async function sepoliaContext(expectedAccount) {
  const ethers = ethereumLibrary();
  const { wallet, address } = await connectWallet();

  if (expectedAccount && expectedAccount.toLowerCase() !== address.toLowerCase()) {
    throw new Error("The sending account changed. Check the wallet address and try again.");
  }

  const provider = new ethers.BrowserProvider(wallet);
  if ((await provider.getNetwork()).chainId !== SEPOLIA_CHAIN_ID) {
    throw new Error("Select Sepolia in MetaMask before continuing.");
  }

  return { provider, address };
}

function parseAddress(value, ethers) {
  const address = String(value ?? "").trim();
  if (!/^0x[0-9a-f]{40}$/i.test(address) || !ethers.isAddress(address)) {
    throw new Error("Enter a valid wallet address starting with 0x.");
  }
  return ethers.getAddress(address);
}

function parseAmount(value, ethers) {
  const amount = String(value ?? "").trim();
  if (!/^(?:\d+(?:\.\d{1,18})?|\.\d{1,18})$/.test(amount)) {
    throw new Error("Enter a test ETH amount such as 0.001.");
  }
  return ethers.parseEther(amount);
}

function clearResult(prefix) {
  el(`${prefix}-status`).textContent = "";
  el(`${prefix}-result`).textContent = "";
  el(`${prefix}-result`).hidden = true;
  const link = el(`${prefix}-receipt`);
  link.removeAttribute("href");
  link.hidden = true;
}

function displayResult(prefix, lines) {
  const output = el(`${prefix}-result`);
  output.textContent = lines.join("\n");
  output.hidden = false;
}

async function showTransaction(prefix, tx, lines) {
  const status = el(`${prefix}-status`);
  const link = el(`${prefix}-receipt`);
  const details = [...lines, `Transaction hash: ${tx.hash}`];

  displayResult(prefix, details);
  link.href = `${EXPLORER}/tx/${tx.hash}`;
  link.hidden = false;
  status.textContent = "Submitted. Waiting for Sepolia confirmation…";

  const receipt = await tx.wait(1, 120000);
  if (receipt?.status !== 1) {
    status.textContent = "Open the receipt to check the final status.";
    return;
  }

  displayResult(prefix, [...details, `Block: ${receipt.blockNumber}`]);
  status.textContent = "Confirmed on Sepolia.";
  return receipt;
}

function reportTransactionError(prefix, error) {
  const pending = error.code === "TIMEOUT" && !el(`${prefix}-receipt`).hidden;
  el(`${prefix}-status`).textContent = pending
    ? "Submitted. Open the receipt to check its latest status."
    : errorMessage(error);
}

el("connect").addEventListener("click", async () => {
  if (busy) return;
  setBusy(true);

  try {
    await connectWallet();
    el("wallet-status").textContent = "MetaMask connected on Sepolia.";
  } catch (error) {
    el("wallet-status").textContent = errorMessage(error);
  } finally {
    setBusy(false);
  }
});

el("payment-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !selectedContract()) return;

  const fields = new FormData(event.currentTarget);
  const expectedAccount = account;
  setBusy(true);
  clearResult("payment");

  try {
    const ethers = ethereumLibrary();
    const recipient = parseAddress(fields.get("recipient"), ethers);
    const value = parseAmount(fields.get("amount"), ethers);

    if (recipient === ethers.ZeroAddress) {
      throw new Error("Enter the recipient’s wallet address.");
    }
    if (value <= 0n) throw new Error("Enter an amount greater than zero.");

    el("payment-status").textContent = "Connecting to MetaMask on Sepolia…";
    const { provider, address } = await sepoliaContext(expectedAccount);
    const signer = await provider.getSigner(address);

    el("payment-status").textContent = "Review the recipient and amount in MetaMask.";
    const tx = await signer.sendTransaction({
      to: recipient,
      value,
      chainId: SEPOLIA_CHAIN_ID
    });

    await showTransaction("payment", tx, [
      "Type: Direct wallet payment",
      `From: ${tx.from}`,
      `To: ${recipient}`,
      `Amount: ${ethers.formatEther(tx.value)} Sepolia test ETH`
    ]);
  } catch (error) {
    reportTransactionError("payment", error);
  } finally {
    setBusy(false);
  }
});

function actionFragment() {
  return actionSelect.value
    ? selectedAbi()?.getFunction(actionSelect.value)
    : null;
}

function addActionField(name, text, required = true) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.name = name;
  input.required = required;
  input.autocomplete = "off";
  label.textContent = text;
  label.append(input);
  el("action-fields").append(label);
  return input;
}

function renderActionFields() {
  el("action-fields").replaceChildren();
  const fragment = actionFragment();

  if (!fragment) {
    el("run").textContent = "Run action";
    setBusy(busy);
    return;
  }

  fragment.inputs.forEach((parameter, index) => {
    const isRecipient = parameter.type === "address" &&
      ["issuePass", "registerVehicle"].includes(fragment.name) &&
      fragment.inputs.filter((input) => input.type === "address").length === 1;

    const name = isRecipient
      ? "Customer wallet address"
      : parameter.name || `Input ${index + 1}`;

    const field = addActionField(
      `arg${index}`, `${name} (${parameter.type})`, parameter.type !== "string"
    );

    if (parameter.type === "address") field.placeholder = "0x…";
    if (fragment.name === "jobs" && index === 0) field.value = "1";
    if (["array", "tuple"].includes(parameter.baseType)) {
      field.placeholder = "Enter a JSON array";
    }
  });

  if (fragment.payable) {
    const input = addActionField("amount", "Amount in Sepolia test ETH");
    input.inputMode = "decimal";
    input.placeholder = "0.001";
  }

  el("run").textContent = fragment.constant ? "Read result" : "Review in MetaMask";
  setBusy(busy);
}

function renderContract() {
  const config = selectedContract();
  const abi = selectedAbi();

  el("description").textContent = config?.description || "";
  el("contract-address").textContent = config ? `Sepolia contract: ${config.address}` : "";
  el("payment-context").textContent = config
    ? `Selected contract: ${contractSelect.value}. This form pays the wallet you enter.`
    : "Choose a business and contract above.";

  const actions = abi?.fragments.filter((fragment) =>
    fragment.type === "function" && Object.hasOwn(config.actions, fragment.name)
  ) ?? [];

  actionSelect.replaceChildren(...actions.map((fragment) =>
    new Option(config.actions[fragment.name], fragment.format("sighash"))
  ));

  el("abi-status").textContent = abi
    ? "ABI loaded. Choose an action."
    : config ? `Upload the ABI exported from Remix for ${contractSelect.value}.`
    : "Choose a contract first.";

  renderActionFields();
}

function selectionChanged() {
  el("abi").value = "";
  clearResult("action");
  renderContract();
  void loadHistory(true);
}

businessSelect.addEventListener("change", () => {
  const names = businesses[businessSelect.value] || [];
  contractSelect.replaceChildren(
    new Option(names.length ? "Choose a contract" : "Choose a business first", ""),
    ...names.map((name) => new Option(name, name))
  );
  selectionChanged();
});

contractSelect.addEventListener("change", selectionChanged);
actionSelect.addEventListener("change", renderActionFields);

el("abi").addEventListener("change", async (event) => {
  const [file] = event.target.files;
  const name = contractSelect.value;
  if (!file || !name || busy) return;

  setBusy(true);
  clearResult("action");

  try {
    const ethers = ethereumLibrary();
    const json = JSON.parse(await file.text());
    const entries = Array.isArray(json) ? json : json?.abi;
    if (!Array.isArray(entries)) throw new Error("Use the ABI JSON exported from Remix.");

    const abi = new ethers.Interface(entries);
    const supported = abi.fragments.some((fragment) =>
      fragment.type === "function" && Object.hasOwn(contracts[name].actions, fragment.name)
    );
    if (!supported) throw new Error(`This ABI has no supported actions for ${name}.`);

    abis.set(name, abi);
    renderContract();
  } catch (error) {
    abis.delete(name);
    el("abi").value = "";
    renderContract();
    el("abi-status").textContent = errorMessage(error);
  } finally {
    setBusy(false);
  }
});

function parseInput(parameter, value, ethers) {
  if (parameter.type === "address") return parseAddress(value, ethers);
  if (["array", "tuple"].includes(parameter.baseType)) return JSON.parse(value);

  if (parameter.type === "bool") {
    const text = value.trim();
    if (text === "true") return true;
    if (text === "false") return false;
    throw new Error("Enter true or false for the Boolean field.");
  }

  return parameter.type === "string" ? value : value.trim();
}

function contractEvents(receipt, abi, address) {
  const events = [];

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;

    try {
      const entry = abi.parseLog(log);
      if (!entry) continue;
      const fields = entry.fragment.inputs.map((input, index) =>
        `${input.name || `Value ${index + 1}`}: ${String(entry.args[index])}`
      );
      events.push(`${entry.name} — ${fields.join(", ")}`);
    } catch {
      // The uploaded ABI may omit this event.
    }
  }
  return events;
}

el("action-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const fragment = actionFragment();
  if (busy || !fragment) return;

  const fields = new FormData(event.currentTarget);
  const config = selectedContract();
  const abi = selectedAbi();
  const expectedAccount = account;
  setBusy(true);
  clearResult("action");

  try {
    const ethers = ethereumLibrary();
    const args = fragment.inputs.map((parameter, index) =>
      parseInput(parameter, fields.get(`arg${index}`), ethers)
    );

    const { provider, address } = await sepoliaContext(expectedAccount);
    if (await provider.getCode(config.address) === "0x") {
      throw new Error("No deployed contract was found at this address on Sepolia.");
    }

    const runner = fragment.constant ? provider : await provider.getSigner(address);
    const contract = new ethers.Contract(config.address, abi, runner);
    const method = contract.getFunction(fragment.format("sighash"));

    if (fragment.constant) {
      const values = await method.staticCallResult(...args);
      displayResult("action", fragment.outputs.map((field, index) => {
        const value = JSON.stringify(values[index], (_, item) =>
          typeof item === "bigint" ? item.toString() : item
        );
        return `${field.name || `Result ${index + 1}`}: ${value}`;
      }));
      el("action-status").textContent = "Result read from Sepolia.";
      return;
    }

    const overrides = { chainId: SEPOLIA_CHAIN_ID };
    if (fragment.payable) {
      overrides.value = parseAmount(fields.get("amount"), ethers);
    }

    el("action-status").textContent = "Review the contract action in MetaMask.";
    const tx = await method.send(...args, overrides);
    const lines = [
      `Action: ${config.actions[fragment.name]}`,
      `From: ${tx.from}`,
      `Contract: ${config.address}`,
      `Test ETH sent: ${ethers.formatEther(tx.value)}`
    ];

    const receipt = await showTransaction("action", tx, lines);
    if (receipt) {
      displayResult("action", [
        ...lines,
        `Transaction hash: ${tx.hash}`,
        `Block: ${receipt.blockNumber}`,
        ...contractEvents(receipt, abi, config.address)
      ]);
      void loadHistory(true);
    }
  } catch (error) {
    reportTransactionError("action", error);
  } finally {
    setBusy(false);
  }
});

function formatTestEth(wei) {
  const digits = BigInt(wei ?? "0").toString().padStart(19, "0");
  const fraction = digits.slice(-18).replace(/0+$/, "");
  return digits.slice(0, -18) + (fraction ? `.${fraction}` : "");
}

function shorten(value) {
  return value ? `${value.slice(0, 8)}…${value.slice(-4)}` : "—";
}

function renderHistory() {
  const body = el("history-rows");
  const config = selectedContract();
  body.replaceChildren();
  if (!config) return;

  for (const tx of transactions.values()) {
    const method = tx.method;
    const action = Object.hasOwn(config.actions, method)
      ? config.actions[method]
      : method || (tx.created_contract ? "Deploy contract" : "Contract transaction");
    const status = tx.status === "ok" ? "Success"
      : tx.status === "error" ? "Failed"
      : tx.timestamp ? "Unknown" : "Pending";
    const sender = tx.from?.hash;
    const row = body.insertRow();

    for (const value of [
      action,
      tx.timestamp ? new Date(tx.timestamp).toLocaleString() : "Pending",
      shorten(sender),
      formatTestEth(tx.value),
      status
    ]) {
      row.insertCell().textContent = value;
    }
    row.cells[2].title = sender || "";

    const cell = row.insertCell();
    if (typeof tx.hash === "string" && /^0x[0-9a-f]{64}$/i.test(tx.hash)) {
      const link = document.createElement("a");
      link.href = `${EXPLORER}/tx/${tx.hash}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = shorten(tx.hash);
      link.title = tx.hash;
      cell.append(link);
    }
  }
}

async function loadHistory(reset) {
  historyRequest?.abort();
  const controller = new AbortController();
  historyRequest = controller;

  if (reset) {
    transactions.clear();
    nextPage = null;
    renderHistory();
  }

  const config = selectedContract();
  const status = el("history-status");
  const more = el("history-more");
  const showAll = el("history-all").checked;
  const wallet = account?.toLowerCase();

  more.hidden = true;
  more.disabled = true;

  if (!config) {
    status.textContent = "Choose a business and contract to see its history.";
    return;
  }

  if (!showAll && !wallet) {
    status.textContent = "Connect MetaMask to filter by wallet, or tick Show all wallets.";
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
      if (showAll || addresses.some((address) => address?.toLowerCase() === wallet)) {
        transactions.set(tx.hash, tx);
      }
    }

    renderHistory();
    if (transactions.size) {
      status.textContent = `${transactions.size} matching transaction(s) shown.`;
    } else {
      status.textContent = nextPage
        ? "No matches on this page. Click Load older transactions."
        : "No matching transactions found.";
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      status.textContent = `Could not load history. ${errorMessage(error)} Try Refresh history.`;
    }
  } finally {
    if (!controller.signal.aborted) {
      more.hidden = !nextPage;
      more.disabled = !nextPage;
    }
  }
}

el("history-refresh").addEventListener("click", () => loadHistory(true));
el("history-all").addEventListener("change", () => loadHistory(true));
el("history-more").addEventListener("click", () => loadHistory(false));

renderContract();
void loadHistory(true);
