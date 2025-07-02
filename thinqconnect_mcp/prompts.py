"""
    * SPDX-FileCopyrightText: Copyright 2025 LG Electronics Inc.
    * SPDX-License-Identifier: Apache-2.0
"""
from dataclasses import dataclass
from typing import Dict, List


@dataclass
class PromptTemplate:
    """Basic prompt template class"""

    title: str
    description: str
    sections: List[Dict[str, str]]
    examples: List[str]

    def format(self) -> str:
        """Format prompt template to string"""
        sections_str = "\n\n".join(f"## {section['title']}\n{section['content']}" for section in self.sections)

        examples_str = "\n".join(f"- {example}" for example in self.examples)

        return f"""# {self.title}

{self.description}

{sections_str}

## Usage Examples:
{examples_str}
"""


class WelcomePrompt(PromptTemplate):
    """Welcome message prompt"""

    def __init__(self):
        super().__init__(
            title="Welcome to ThinQ Connect MCP Server",
            description="""Through the ThinQ Connect MCP server, you can easily manage and query ThinQ devices and data
by interacting with the ThinQ Connect OPEN API platform using natural language.
By default, it uses the ThinQ Connect Python SDK to interact with the ThinQ Connect OpenAPI platform.""",
            sections=[
                {
                    "title": "Available Operations",
                    "content": """1. **Device List Query**
   - "Query all device lists"

2. **Device Information Query**
   - "Query device status"

3. **Device Control**
   - "Turn on device power"
   - "Change device status"
   - "Control options for each device"
""",
                }
            ],
            examples=[
                "Please provide a list of all devices",
                "Please check the status of the robot vacuum device",
                "Please set the temperature of the air conditioner device to 24 degrees",
            ],
        )


def welcome_prompt() -> str:
    return WelcomePrompt().format()
