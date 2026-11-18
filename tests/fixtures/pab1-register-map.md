| Offset | Word | Name            | Size   | Format   | Access | Description |
| ------ | ---- | --------------- | ------ | -------- | ------ | ----------- |
| 0      | 0    | firmwareVersion | 4 byte | bitfield | RW     |             |

Firmware version

| Offset | Name         | Size   | Type | Description   |
| ------ | ------------ | ------ | ---- | ------------- |
| byte 0 | minorVersion | 2 byte | u16  | Minor version |
| byte 2 | majorVersion | 2 byte | u16  | Major version |

|  
| 4 | 1 | hwVersion | 4 byte | enum | R |

HW version

| Value | Name        |
| ----- | ----------- |
| 0     | Non-defined |
| 1     | AC701       |
| 2     | Z0          |
| 3     | Z1          |

|  
| 8 | 2 | pciExpressType | 4 byte | bitfield | R |

PCIe type (gen, lanes)

| Offset | Name  | Size   | Type | Description                    |
| ------ | ----- | ------ | ---- | ------------------------------ |
| byte 0 | gen   | 2 byte | u16  | PCIe generation type (1,2,3,4) |
| byte 2 | lanes | 2 byte | u16  | PCIe numbe of lanes            |

|  
| 12 | 3 | pcieEngine | 4 byte | enum | R |

PCIe engine (XDMA is the only available for now)

| Value | Name        |
| ----- | ----------- |
| 0     | Non-defined |
| 1     | XDMA        |

|  
| 16 | 4 | dataChannelInterface | 4 byte | enum | R |

Data channel interface for engine

| Value | Name        |
| ----- | ----------- |
| 0     | Non-defined |
| 1     | AXI-Stream  |
| 2     | AXI-MM      |

|  
| 20 | 5 | numOfDataChannels | 4 byte | bitfield | R |

Number of data channels for C2H and H2C

| Offset | Name            | Size   | Type | Description                 |
| ------ | --------------- | ------ | ---- | --------------------------- |
| byte 0 | c2hDataChannels | 2 byte | u16  | Number of C2H data channels |
| byte 2 | h2cDataChannels | 2 byte | u16  | Number of H2C data channels |

|  
| 24 | 6 | c2hStreamBufferStatus | 4 byte | bitfield | R |

C2H stream buffer statuses

| Offset | Name                  | Size   | Type | Description                                                                |
| ------ | --------------------- | ------ | ---- | -------------------------------------------------------------------------- |
| byte 0 | overflowCounts        | 2 byte | u16  | Overflow counts for 128 bit data elements for actual acquisition.          |
| byte 2 | xdmaC2hOverflowCounts | 2 byte | u16  | XDMA C2H overflow counts for 128 bit data elements for actual acquisition. |

|  
| 28 | 7 | testDataControl | 4 byte | bitfield | R/W |

C2H stream buffer statuses

| Offset | Name         | Size   | Type | Description                                                                                |
| ------ | ------------ | ------ | ---- | ------------------------------------------------------------------------------------------ |
| bit 0  | testDataType | 2 bit  | u2   | 0: N/A; 1: Incremental (128 bit) test data.; 2: Pseudo-random (128 bit) test data.; 3: N/A |
| bit 2  | reserved     | 30 bit | u30  |                                                                                          |

|  
| 32 | 8 | blockSize | 4 byte | uint | R/W | Block size. The block size can be set in words (32 bit elements). Only multiples of 4 is acceptable (because of the 128 bit interface - easy). The default value: 14400. |  
| 36 | 9 | bandwidthControl | 4 byte | bitfield | R/W |

Bandwidth control settings.

| Offset | Name               | Size   | Type | Description                                                                                                                                                                                       |
| ------ | ------------------ | ------ | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| byte 0 | frameRateReduction | 1 byte | u8   | The purpose of this register is to set the frame rate. The calculation for bandwith based on the register is the following: 16\*(frameReduction+1)/256 \[Gb/s\]. The default value: 79 -> 5 Gb/s. |
| byte 1 | reserved           | 3 byte | u24  |                                                                                                                                  |

|  
| 40 | 10 | acqControl | 4 byte | bitfield | R/W |

Acquisition control bits.

| Offset | Name     | Size   | Type | Description                                                                |
| ------ | -------- | ------ | ---- | -------------------------------------------------------------------------- |
| bit 0  | acqOn    | 1 bit  | u1   | Acquisition on. Rising edge starts and falling edge stops the acquisition. |
| bit 1  | reserved | 31 bit | u31  |                                                                                      |

|  
| 44 | 11 | streamBufferSize | 4 byte | bitfield | R |

Buffer size. Readback value of the available buffer size in KB.

| Offset | Name               | Size   | Type | Description               |
| ------ | ------------------ | ------ | ---- | ------------------------- |
| byte 0 | streamBufferSizeKB | 2 byte | u16  | Stream buffer size in KB. |
| byte 2 | reserved           | 2 byte | u16  |                         |

|
