"""
    * SPDX-FileCopyrightText: Copyright 2025 LG Electronics Inc.
    * SPDX-License-Identifier: Apache-2.0
"""
import inspect
import logging
from datetime import datetime
from typing import List

from aiohttp import ClientSession
from thinqconnect import (
    AirConditionerDevice,
    AirPurifierDevice,
    AirPurifierFanDevice,
    CeilingFanDevice,
    CooktopDevice,
    DehumidifierDevice,
    DishWasherDevice,
    DryerDevice,
    HomeBrewDevice,
    HoodDevice,
    HumidifierDevice,
    KimchiRefrigeratorDevice,
    MicrowaveOvenDevice,
    OvenDevice,
    PlantCultivatorDevice,
    RefrigeratorDevice,
    RobotCleanerDevice,
    StickCleanerDevice,
    StylerDevice,
    SystemBoilerDevice,
    ThinQApi,
    VentilatorDevice,
    WashcomboMainDevice,
    WashcomboMiniDevice,
    WasherDevice,
    WashtowerDevice,
    WashtowerDryerDevice,
    WashtowerWasherDevice,
    WaterHeaterDevice,
    WaterPurifierDevice,
    WineCellarDevice,
)
from thinqconnect.devices.connect_device import ConnectBaseDevice

logger = logging.getLogger(__name__)

local_device_profiles = {}
local_device_lists = []
device_class_mapping = {
    "DEVICE_AIR_CONDITIONER": AirConditionerDevice,
    "DEVICE_AIR_PURIFIER": AirPurifierDevice,
    "DEVICE_AIR_PURIFIER_FAN": AirPurifierFanDevice,
    "DEVICE_CEILING_FAN": CeilingFanDevice,
    "DEVICE_COOKTOP": CooktopDevice,
    "DEVICE_DEHUMIDIFIER": DehumidifierDevice,
    "DEVICE_DISH_WASHER": DishWasherDevice,
    "DEVICE_DRYER": DryerDevice,
    "DEVICE_HOME_BREW": HomeBrewDevice,
    "DEVICE_HOOD": HoodDevice,
    "DEVICE_HUMIDIFIER": HumidifierDevice,
    "DEVICE_KIMCHI_REFRIGERATOR": KimchiRefrigeratorDevice,
    "DEVICE_MICROWAVE_OVEN": MicrowaveOvenDevice,
    "DEVICE_OVEN": OvenDevice,
    "DEVICE_PLANT_CULTIVATOR": PlantCultivatorDevice,
    "DEVICE_REFRIGERATOR": RefrigeratorDevice,
    "DEVICE_ROBOT_CLEANER": RobotCleanerDevice,
    "DEVICE_STICK_CLEANER": StickCleanerDevice,
    "DEVICE_STYLER": StylerDevice,
    "DEVICE_SYSTEM_BOILER": SystemBoilerDevice,
    "DEVICE_VENTILATOR": VentilatorDevice,
    "DEVICE_WASHCOMBO_MAIN": WashcomboMainDevice,
    "DEVICE_WASHCOMBO_MINI": WashcomboMiniDevice,
    "DEVICE_WASHER": WasherDevice,
    "DEVICE_WASHTOWER": WashtowerDevice,
    "DEVICE_WASHTOWER_DRYER": WashtowerDryerDevice,
    "DEVICE_WASHTOWER_WASHER": WashtowerWasherDevice,
    "DEVICE_WATER_HEATER": WaterHeaterDevice,
    "DEVICE_WATER_PURIFIER": WaterPurifierDevice,
    "DEVICE_WINE_CELLAR": WineCellarDevice,
}


async def get_device_list(thinq_api: ThinQApi) -> List[str]:
    """
    Get device list
    """
    global local_device_lists
    try:
        thinq_api._session = ClientSession()
        if not local_device_lists:
            devices = await thinq_api.async_get_device_list()
            local_device_lists = devices
        else:
            devices = local_device_lists
        device_info = []
        for device in devices:
            device_info.append(
                f"Device ID: {device.get('deviceId')}\n"
                f"Device Name: {device.get('deviceInfo').get('alias')}\n"
                f"Device Type: {device.get('deviceInfo').get('deviceType')}\n"
                f"Model Name: {device.get('deviceInfo').get('modelName')}\n"
            )
        header = f"Found {len(devices)} devices:\n\n"
        return header + "\n".join(device_info)

    except Exception as e:
        return f"An error occurred while retrieving device list: {str(e)}"


async def get_device_available_controls(thinq_api: ThinQApi, device_type: str, device_id: str) -> str:
    """
    Get available control command information from device
    """
    try:
        global local_device_profiles
        thinq_api._session = ClientSession()
        if not local_device_profiles.get(device_id):
            device_profile = await thinq_api.async_get_device_profile(device_id=device_id)
            local_device_profiles[device_id] = device_profile
        else:
            device_profile = local_device_profiles[device_id]

        device_class = device_class_mapping.get(device_type)
        if not device_class:
            raise ValueError(f"Unsupported device type: {device_type}")

        # Create device object
        device = device_class(
            thinq_api=thinq_api,
            device_id="device_id",
            device_type=device_type,
            model_name="model_name",
            alias="alias",
            reportable=True,
            profile=device_profile,
        )

        device_methods = [
            (
                name,
                str(inspect.signature(getattr(device, name))).split(" -> ")[0],
            )  # (method name, parameter info)
            for name in dir(device)
            if callable(getattr(device, name))  # Check if it's a function
            and name not in dir(ConnectBaseDevice)  # Exclude inherited from parent class
            and not name.startswith("__")  # Exclude internal methods
        ]
        writable_properties = str(device.profiles.writable_properties)
        methods = "\n".join(map(str, device_methods))
        profile = str(device_profile)
        current_time = datetime.now()
        return f"""# Device Control Instruction Guide**
This guide provides instructions for IoT device control using structured data formats:
- **Profile**: JSON-based device capabilities and properties
- **Writable Properties**: List of controllable device properties
- **Methods**: List of available control methods

## Validation Rules (Critical)
Before executing any control command, verify:
1. **Property exists** in `Writable Properties` list
2. **Method exists** in `Methods` list
3. **Valid mapping** between method and property:
   - Standard format: `set_{{property_name}}`
   - Example: Method `set_air_con_operation_mode` maps to property `air_con_operation_mode`
   - Some methods handle multiple properties (e.g., `set_relative_time_to_start` for both `relative_hour_to_start` and `relative_minute_to_start`)
4. **Both method AND property must be present** for control to be permitted

**If validation fails**: Respond with `"This control is not supported on this device."`

## Naming Convention
- **Profile JSON**: camelCase (`airConOperationMode`, `coolTargetTemperature`)
- **Writable Properties & Methods**: snake_case (`air_con_operation_mode`, `cool_target_temperature`)
Accurate camelCase ↔ snake_case mapping is essential for proper execution.

## Data Structures
### Writable Properties
{writable_properties}
### Methods
{methods}
### Profile
{profile}

## Control Command Execution
Use the `post_device_control` tool with these parameters:
{{
  "device_type": "<DEVICE_TYPE>",
  "device_id": "<DEVICE_UNIQUE_ID>",
  "control_method": "<METHOD_NAME>",
  "control_params": {{
    "<param_name>": <param_value>
  }}
}}

### Parameter Types & Validation
Based on Profile `type` field:
- **enum**: Must use exact values from Profile's `value` array
- **boolean**: `true` or `false`
- **number**: Numeric value
- **range**: Value within `min`~`max` bounds, respecting `step` intervals

### Time-Based Controls
**Current Time**: {current_time.strftime('%Y-%m-%d %H:%M:%S')}

For time-related commands:
- **Relative time requests** ("in 2 hours"): Calculate interval from current time
- **Absolute time requests** ("turn on at 7 PM"): Convert to relative time if only relative control is supported
- **Future time guarantee**: If requested time is past, assume next day
- **Example calculation**:
  - Current: 15:20, Request: 19:00
  - Result: `{{"relative_hour_to_start": 3, "relative_minute_to_start": 40}}`

### Control Examples

**Single parameter:**
{{
  "control_method": "set_air_con_operation_mode",
  "control_params": {{"operation": "POWER_OFF"}}
}}

**Multiple parameters:**
{{
  "control_method": "set_relative_time_to_start",
  "control_params": {{"hour": 10, "minute": 30}}
}}
```

## Profile Structure Reference
Profile JSON contains device capabilities with this structure:
{{
  "propertyName": {{
    "type": "enum|boolean|number|range",
    "mode": ["r", "w"],  // r=readable, w=writable
    "value": {{
      "r": [/* readable values */],
      "w": [/* writable values */]
    }},
    "unit": "C|F|...",  // for temperature/measurement properties
    "min": 0,           // for range type
    "max": 100,         // for range type
    "step": 1           // for range type
  }}
}}

**Control Permission**: Property must have `"w"` in `mode` array to be controllable.
## Error Handling
- **Power-off errors**: Check device status with `get_device_status` and turn on power first
- **Invalid parameters**: Verify parameter values match Profile specifications
- **Missing capabilities**: Use validation rules to confirm method/property support
"""
    except Exception as e:
        return f"An error occurred while retrieving device details: {str(e)}"


async def post_device_control(
    thinq_api: ThinQApi,
    device_type: str,
    device_id: str,
    control_method: str,
    control_params: dict,
) -> str:
    """
    Device Control
    """
    try:
        global local_device_profiles
        thinq_api._session = ClientSession()
        if not local_device_profiles.get(device_id):
            device_profile = await thinq_api.async_get_device_profile(device_id=device_id)
            local_device_profiles[device_id] = device_profile
        else:
            device_profile = local_device_profiles[device_id]

        device_class = device_class_mapping.get(device_type)
        if not device_class:
            raise ValueError(f"Unsupported device type: {device_type}")

        # Create device object
        device = device_class(
            thinq_api=thinq_api,
            device_id=device_id,
            device_type=device_type,
            model_name="model_name",
            alias="alias",
            reportable=True,
            profile=device_profile,
        )

        # Call device control method
        if hasattr(device, control_method):
            method = getattr(device, control_method)
            sig = inspect.signature(method)  # Get method signature (parameter information)

            # Prepare arguments for each method parameter
            kwargs = {}
            for param_name, param in sig.parameters.items():
                if param_name in control_params:
                    param_type = param.annotation
                    value = control_params[param_name]

                    # Convert based on parameter type
                    if param_type == int or param_type == "int":
                        kwargs[param_name] = int(value)
                    elif param_type == str or param_type == "str":
                        kwargs[param_name] = str(value)
                    else:
                        kwargs[param_name] = value

            await method(**kwargs)
        else:
            return f"Command '{control_method}' not found."

        return f"Device control completed. Please relay appropriately to the user. Command: {control_method}, Parameters: {control_params}"
    except Exception as e:
        return f"An error occurred during device control: {str(e)}, Command: {control_method}, Parameters: {control_params}"


async def get_device_status(thinq_api: ThinQApi, device_id: str) -> str:
    """
    Retrieve status information for a specific device.
    """
    try:
        thinq_api._session = ClientSession()
        device_status = await thinq_api.async_get_device_status(device_id=device_id)
        return f"""Device status information is as follows.
Please relay appropriately to the user.
## Status Information
{device_status}
"""
    except Exception as e:
        return f"An error occurred while retrieving device status: {str(e)}"
