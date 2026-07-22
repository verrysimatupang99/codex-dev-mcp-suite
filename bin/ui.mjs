#!/usr/bin/env node
import { startUiServer } from "../lib/ui-server.js";

const port = Number(process.env.PORT || 3333);
startUiServer(port);
