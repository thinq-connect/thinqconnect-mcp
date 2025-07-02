![Local Image](https://www.lge.co.kr/kr/main/thinq/images/main/thinq_logo.png)


# ThinQ Connect MCP Server (Beta)
This is the official MCP (Model Context Protocol) server for LG ThinQ devices.
This server provides integrated control capabilities including status monitoring, device control, and profile information for various LG ThinQ devices, built on the LG ThinQ API and Python Open SDK. MCP connection method is stdio.

![ThinQ Connect MCP Demo](demo.gif)

## Table of Contents


- [Features](#features)
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Detailed Usage](#detailed-usage)
- [Tool Reference](#tool-reference)


## Features

- **Device List Query**  
  Retrieve a list of all registered LG ThinQ devices.

- **Device Status Monitoring**  
  Get real-time status information for specific devices.

- **Device Control**  
  Execute control commands defined in each device's profile.  
  (e.g., turn air conditioner on/off, set temperature, etc.)

- **Device Control Capabilities Query**  
  Provide detailed information about controllable properties, methods information for each device.

---

## Prerequisites
1. Prepare a [Personal Access Token](https://github.com/thinq-connect/pythinqconnect/blob/main/README.md#obtaining-and-using-a-personal-access-token) for ThinQ Open API calls
2. Verify your ThinQ account's country code. You can find it in the [Country Codes](https://github.com/thinq-connect/pythinqconnect/blob/main/README.md#country-codes) section.
3. Python 3.11 or higher
4. Install [uv](https://docs.astral.sh/uv/) - A fast Python package installer and resolver for Python projects
5. MCP client (Claude Desktop, etc.)


---


## Quick Start

### Claude Desktop
Open up the configuration file, and add ThinQ Connect MCP config.
* macOS: ~/Library/Application Support/Claude/claude_desktop_config.json
* Windows: %APPDATA%\Claude\claude_desktop_config.json
```json
{
  "mcpServers": {
    "thinqconnect-mcp": {
      "command": "uvx",
      "args": [
        "thinqconnect-mcp"
      ],
      "env": {
          "THINQ_PAT": "your_personal_access_token_here",
          "THINQ_COUNTRY": "your_country_code_here"
      }
    }
  }
}
```

---

## Detailed Usage

After setting up the configuration file as shown in the Quick Start section, you can use the ThinQ Connect MCP Server directly in your conversations with Claude.

Examples of prompts you can use:

 * "Please provide a list of all devices"
 * "Please check the status of the robot vacuum device"
 * "Please set the temperature of the air conditioner device to 24 degrees"


---

## Tool Reference

### Available Tools

1. **get_device_list**
   - Description: Retrieves a list of all devices connected to the ThinQ Connect platform
   - Parameters: None
   - Returns: String containing connected device list information

2. **get_device_available_controls**
   - Description: Retrieves available control commands and parameter information for a specific device
   - Parameters: device_type (string), device_id (string)
   - Returns: String containing device control commands and parameter information

3. **get_device_status**
   - Description: Retrieves status information for a specific device
   - Parameters: device_id (string)
   - Returns: String containing device status information

4. **post_device_control**
   - Description: Send control commands to a specific device on the ThinQ Connect platform to change its settings or state
   - Parameters: device_type (string), device_id (string), control_method (string), control_params (dict)
   - Returns: String containing device control result message
