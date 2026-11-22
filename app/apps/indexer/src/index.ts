import { ponder } from "ponder:registry";
import {
  onONFTReceived,
  onONFTSent,
  onPassportImported,
  onPassportIssued,
  onPassportRevised,
  onTransfer,
} from "./handlers";

ponder.on("WhiskyDistillery:Transfer", onTransfer);
ponder.on("WhiskyDistillery:PassportIssued", onPassportIssued);
ponder.on("WhiskyDistillery:PassportRevised", onPassportRevised);
ponder.on("WhiskyDistillery:PassportImported", onPassportImported);
ponder.on("WhiskyDistillery:ONFTSent", onONFTSent);
ponder.on("WhiskyDistillery:ONFTReceived", onONFTReceived);
