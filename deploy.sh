#!/bin/bash

sudo cp ai.service /etc/systemd/system/.

sudo systemctl daemon-reload

sudo systemctl stop ai
sudo systemctl start ai
sudo systemctl enable ai