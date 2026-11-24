"use strict";

const SEPOLIA = "0xaa36a7";
const EXPLORER = "https://sepolia.etherscan.io";

const contracts = {
  RepairEscrow: {
    address: "0xc8045f8005ea577f4294ba91a3326a5bb250b33c",
    description: "The customer funds a repair, the garage completes it, and the customer approves payment.",
    remix: "In Remix, call jobs with the job ID to see the amount and status.",
    actions: {
      jobs: "Check a repair job",
      openJob: "Fund a new repair job",
      startJob: "Start the repair",
      completeJob: "Mark the repair complete",
      approveCompletion: "Approve and release payment",
      requestExtraWork: "Request extra work",
      approveExtra: "Approve extra work",
      raiseDispute: "Raise a dispute",
      resolveDispute: "Resolve a dispute"
    }
  },
  ServicePassport: {
    address: "0x46db0219446508cca536903cbfc6180e2162668b",
    description: "The garage registers a vehicle and records its service history.",
    remix: "In Remix, use recordCount or getRecord with the passport ID.",
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
    description: "The florist issues a prepaid flower pass and records each delivery.",
    remix: "In Remix, call passes with the token ID to check deliveries remaining.",
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
    description: "The customer funds a booking, the florist marks it delivered, and the customer confirms receipt.",
    remix: "In Remix, use the booking lookup with the booking ID.",
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
const interfaces = new Map();
const contractSelect = el("contract");
const actionSelect = el("action");
const currentContract = () => contracts[contractSelect.value];
const currentAbi = () => interfaces.get(contractSelect.value);

let announcedMetaMask;
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

function setBusy(value) {
  busy = value;
  for (const id of ["connect", "contract", "abi"]) {
    el(id).disabled = value;
  }
  actionSelect.disabled = value || actionSelect.options.length === 0;
  el("run").disabled = actionSelect.disabled;
}

function clearResult() {
  el("receipt").hidden = true;
  el("result").textContent = "";
  el("remix").hidden = true;
}

function showError(error) {
  const messages = {
    4001: "The request was declined in MetaMask.",
    4902: "Switch to Sepolia in MetaMask, then try again.",
    "-32002": "Open MetaMask and review its pending request.",
    ACTION_REJECTED: "The request was declined in MetaMask."
  };
  setStatus(messages[error.code] || error.shortMessage || error.message || "The action failed.");
}

function ethereumLibrary() {
  if (!window.ethers) {
    throw new Error("The ethers library could not load. Check your internet connection and reload.");
  }
  return window.ethers;
}

async function connectWallet() {
  const injected = window.ethereum;
  const wallet =
    announcedMetaMask ??
    injected?.providers?.find((provider) => provider.isMetaMask) ??
    (injected?.isMetaMask ? injected : undefined);

  if (!wallet) {
    throw new Error("MetaMask was not detected. Open this page in the Chrome or Edge profile where MetaMask is installed.");
  }

  let accounts = await wallet.request({ method: "eth_accounts" });
  if (!accounts.length) {
    accounts = await wallet.request({ method: "eth_requestAccounts" });
  }
  if (!accounts.length) throw new Error("Select an account in MetaMask.");

  const chainId = await wallet.request({ method: "eth_chainId" });
  if (chainId !== SEPOLIA) {
    await wallet.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: SEPOLIA }]
    });
  }

  const [account] = await wallet.request({ method: "eth_accounts" });
  if (!account) throw new Error("Unlock MetaMask and select an account on Sepolia.");

  el("wallet").textContent = "Sepolia wallet: " + account;
  return { wallet, account };
}

function renderContract() {
  const contract = currentContract();
  el("description").textContent = contract.description;
  el("address").href = EXPLORER + "/address/" + contract.address;

  const actions = currentAbi()?.fragments.filter((fragment) =>
    fragment.type === "function" && Object.hasOwn(contract.actions, fragment.name)
  ) ?? [];

  actionSelect.replaceChildren(...actions.map((fragment) =>
    new Option(
      contract.actions[fragment.name] + " (" + fragment.name + ")",
      fragment.format("sighash")
    )
  ));

  el("abi-status").textContent = actions.length
    ? "ABI loaded. Choose an action."
    : "Load the ABI exported from Remix for this contract.";

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
    const name = parameter.name || "Input " + (index + 1);
    const input = addField(
      "arg" + index,
      name + " (" + parameter.type + ")",
      parameter.type !== "string"
    );
    if (fragment.name === "jobs" && index === 0) input.value = "1";
    if (["array", "tuple"].includes(parameter.baseType)) {
      input.placeholder = "Enter a JSON array";
    }
  });

  if (fragment.payable) {
    const input = addField("eth", "Amount to send in Sepolia test ETH");
    input.inputMode = "decimal";
    input.placeholder = "0.01";
  }

  el("run").textContent = fragment.constant ? "Read result" : "Review in MetaMask";
}

function parseInput(parameter, value) {
  if (["array", "tuple"].includes(parameter.baseType)) return JSON.parse(value);
  if (parameter.type === "bool") {
    const text = value.trim();
    if (text === "true") return true;
    if (text === "false") return false;
    throw new Error("Enter true or false for " + (parameter.name || "this input") + ".");
  }
  return parameter.type === "string" ? value : value.trim();
}

function describeEvents(receipt, abi, address) {
  const events = [];
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== address) continue;
    try {
      const decoded = abi.parseLog(log);
      if (!decoded) continue;
      const fields = decoded.fragment.inputs.map((input, index) =>
        (input.name || "Value " + (index + 1)) + ": " + String(decoded.args[index])
      );
      events.push(decoded.name + " — " + fields.join(", "));
    } catch {
      continue;
    }
  }
  return events;
}

contractSelect.replaceChildren(
  ...Object.keys(contracts).map((name) => new Option(name, name))
);

contractSelect.addEventListener("change", () => {
  el("abi").value = "";
  clearResult();
  renderContract();
});

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
  if (!file || busy) return;
  const name = contractSelect.value;
  setBusy(true);
  clearResult();

  try {
    const ethers = ethereumLibrary();
    const json = JSON.parse(await file.text());
    const entries = Array.isArray(json) ? json : json?.abi;
    if (!Array.isArray(entries)) {
      throw new Error("Choose the ABI JSON exported from Remix.");
    }

    const abi = new ethers.Interface(entries);
    const hasAction = abi.fragments.some((fragment) =>
      fragment.type === "function" &&
      Object.hasOwn(contracts[name].actions, fragment.name)
    );
    if (!hasAction) throw new Error("This ABI has no supported actions for " + name + ".");

    interfaces.set(name, abi);
    renderContract();
  } catch (error) {
    interfaces.delete(name);
    renderContract();
    showError(error);
  } finally {
    setBusy(false);
  }
});

actionSelect.addEventListener("change", renderFields);

el("form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (busy || !actionSelect.value) return;

  const form = new FormData(event.currentTarget);
  const config = currentContract();
  const abi = currentAbi();
  const signature = actionSelect.value;

  setBusy(true);
  clearResult();

  try {
    const ethers = ethereumLibrary();
    const fragment = abi.getFunction(signature);
    const args = fragment.inputs.map((input, index) =>
      parseInput(input, form.get("arg" + index))
    );

    const overrides = {};
    if (fragment.payable) {
      const amount = form.get("eth").trim();
      if (!/^(?:\d+(?:\.\d{1,18})?|\.\d{1,18})$/.test(amount)) {
        throw new Error("Enter a Sepolia test ETH amount such as 0.01.");
      }
      overrides.value = ethers.parseEther(amount);
    }

    const { wallet, account } = await connectWallet();
    const provider = new ethers.BrowserProvider(wallet);
    if (await provider.getCode(config.address) === "0x") {
      throw new Error("No deployed contract was found at this address on Sepolia.");
    }

    const runner = fragment.constant ? provider : await provider.getSigner(account);
    const contract = new ethers.Contract(config.address, abi, runner);
    const method = contract.getFunction(signature);

    if (fragment.constant) {
      const values = await method.staticCallResult(...args);
      el("result").textContent = fragment.outputs.map((output, index) => {
        const value = JSON.stringify(values[index], (_, item) =>
          typeof item === "bigint" ? item.toString() : item
        );
        return (output.name || "Result " + (index + 1)) + ": " + value;
      }).join("\n");
      setStatus("Result read from Sepolia.");
      return;
    }

    setStatus("Review the transaction in MetaMask.");
    const tx = await method.send(...args, overrides);
    const details = [
      "Action: " + config.actions[fragment.name],
      "Wallet: " + tx.from,
      "Contract: " + config.address,
      "Test ETH sent with this action: " + ethers.formatEther(tx.value),
      "Transaction hash: " + tx.hash
    ];

    el("receipt").href = EXPLORER + "/tx/" + tx.hash;
    el("receipt").hidden = false;
    el("result").textContent = details.join("\n");
    setStatus("Submitted. Waiting for Sepolia confirmation…");

    const receipt = await tx.wait(1, 120000);
    if (!receipt || receipt.status !== 1) {
      setStatus("Check the Etherscan receipt for the final transaction status.");
      return;
    }

    details.push("Block: " + receipt.blockNumber);
    details.push(...describeEvents(receipt, abi, config.address));
    el("result").textContent = details.join("\n");
    el("remix").textContent =
      config.remix + " For a new record, look for its ID in the event details or Etherscan receipt.";
    el("remix").hidden = false;
    setStatus("Transaction confirmed on Sepolia.");
  } catch (error) {
    if (error.code === "TIMEOUT" && !el("receipt").hidden) {
      setStatus("The transaction was submitted. Check Etherscan for its latest status.");
    } else {
      showError(error);
    }
  } finally {
    setBusy(false);
  }
});

renderContract();
setStatus("Ready. Click Connect MetaMask.");