// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract DailyStreakLite {
    error AlreadyCheckedInToday();

    uint64 private constant DAY_SECONDS = 1 days;

    struct Player {
        uint32 streak;
        uint64 totalCheckIns;
        uint64 lastCheckInDay;
    }

    mapping(address => Player) private players;

    event CheckedIn(
        address indexed account,
        uint32 streak,
        uint64 totalCheckIns,
        uint64 day,
        uint64 nextCheckInAt
    );

    function checkIn() external {
        uint64 currentDay = uint64(block.timestamp / DAY_SECONDS);
        Player storage player = players[msg.sender];

        if (player.lastCheckInDay == currentDay) {
            revert AlreadyCheckedInToday();
        }

        if (player.lastCheckInDay + 1 == currentDay && player.lastCheckInDay != 0) {
            player.streak += 1;
        } else {
            player.streak = 1;
        }

        player.totalCheckIns += 1;
        player.lastCheckInDay = currentDay;

        emit CheckedIn(
            msg.sender,
            player.streak,
            player.totalCheckIns,
            currentDay,
            (currentDay + 1) * DAY_SECONDS
        );
    }

    function getStats(address account)
        external
        view
        returns (
            uint32 streak,
            uint64 totalCheckIns,
            uint64 lastCheckInDay,
            bool canCheckInNow,
            uint64 nextCheckInAt
        )
    {
        Player memory player = players[account];
        uint64 currentDay = uint64(block.timestamp / DAY_SECONDS);
        bool can = player.lastCheckInDay < currentDay;
        uint64 nextAt = player.totalCheckIns == 0 ? 0 : (player.lastCheckInDay + 1) * DAY_SECONDS;

        return (
            player.streak,
            player.totalCheckIns,
            player.lastCheckInDay,
            can,
            nextAt
        );
    }
}
