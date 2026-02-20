// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract BatchCheckIn {
    error InvalidCount();

    event CheckedIn(address indexed account, uint256 count);

    function checkIn(uint256 count) external {
        if (count != 1 && count != 10 && count != 100) revert InvalidCount();
        emit CheckedIn(msg.sender, count);
    }
}
