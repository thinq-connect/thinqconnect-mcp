"""
    * SPDX-FileCopyrightText: Copyright 2025 LG Electronics Inc.
    * SPDX-License-Identifier: Apache-2.0
"""
import logging
import os
from typing import Final

from dotenv import load_dotenv
from mcp.server.fastmcp import FastMCP
from thinqconnect import ThinQApi

import thinqconnect_mcp.prompts as prompts
import thinqconnect_mcp.tools as tools

# Environment Variables
load_dotenv()
PAT: Final[str] = os.getenv("THINQ_PAT")
COUNTRY: Final[str] = os.getenv("THINQ_COUNTRY")

# Constants
CLIENT_ID: Final[str] = "thinqconnect-mcp-client"
MCP_NAME: Final[str] = "thinqconnect-mcp"
MCP_DESCRIPTION: Final[str] = "ThinQ Connect MPC Server"


# Validation for environment variables
def validate_config() -> None:
    if not PAT:
        raise ValueError("PAT is not configured. Please set the THINQ_PAT environment variable.")
    if not COUNTRY:
        raise ValueError("Country code is not configured. Please set the THINQ_COUNTRY environment variable.")


# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(name)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


def setup_thinq_api() -> ThinQApi:
    """Initialize and configure ThinQ API client"""
    thinq_api = ThinQApi(session=None, access_token=PAT, country_code=COUNTRY, client_id=CLIENT_ID)
    thinq_api.set_log_level("DEBUG")
    return thinq_api


def setup_mcp() -> FastMCP:
    """Initialize and configure MCP server"""
    return FastMCP(name=MCP_NAME, description=MCP_DESCRIPTION)


# Initialize MCP and API
validate_config()
mcp = setup_mcp()
thinq_api = setup_thinq_api()


# Prompt handlers
@mcp.prompt("I want to know how to use the ThinQ Connect MCP Server")
async def welcome_prompt() -> str:
    return prompts.welcome_prompt()


# Tool handlers
@mcp.tool(
    description="""Retrieves a list of all devices connected to the ThinQ Connect platform
    Args:
        None

    Returns:
        String containing connected device list information
    """
)
async def get_device_list() -> str:
    return await tools.get_device_list(thinq_api=thinq_api)


@mcp.tool(
    description="""Retrieves available control commands and parameter information for a specific device
    Args:
        device_type: Device type (e.g., DEVICE_AIR_CONDITIONER, DEVICE_ROBOT_CLEANER, DEVICE_STYLER)
        device_id: Unique ID of the device to query

    Returns:
        String containing device control commands and parameter information
    """
)
async def get_device_available_controls(device_type: str, device_id: str) -> str:
    return await tools.get_device_available_controls(thinq_api=thinq_api, device_type=device_type, device_id=device_id)


@mcp.tool(
    description="""Retrieves status information for a specific device
    Args:
        device_id: Unique ID of the device to query

    Returns:
        String containing device status information
    """
)
async def get_device_status(device_id: str) -> str:
    return await tools.get_device_status(thinq_api=thinq_api, device_id=device_id)


@mcp.tool(
    description="""Send control commands to a specific device on the ThinQ Connect platform to change its settings or state
    Args:
        device_type: Device type (e.g., DEVICE_AIR_CONDITIONER, DEVICE_ROBOT_CLEANER, DEVICE_STYLER)
        device_id: Unique ID of the device to control
        control_method: Co ntrol method name to execute (e.g., set_air_con_operation_mode, set_target_temperature, set_wind_strength)
        control_params: Parameter dictionary to pass to the control method (e.g., {'operation': 'POWER_OFF'}, {'temperature': 25}, {'wind_strength': 'HIGH'})

    Returns:
        String containing device control result message
    """
)
async def post_device_control(
    device_type: str,
    device_id: str,
    control_method: str,
    control_params: dict,
) -> str:
    return await tools.post_device_control(
        thinq_api=thinq_api,
        device_type=device_type,
        device_id=device_id,
        control_method=control_method,
        control_params=control_params,
    )


def main() -> None:
    """Main entry point of the application"""
    try:
        mcp.run()
    except Exception as e:
        logger.error(f"Application error: {str(e)}")
        raise
