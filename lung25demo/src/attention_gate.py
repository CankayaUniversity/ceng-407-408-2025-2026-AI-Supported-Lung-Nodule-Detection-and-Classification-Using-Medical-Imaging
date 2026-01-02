import torch
import torch.nn as nn
import torch.nn.functional as F


class GridAttentionBlock2D(nn.Module):
    """
    Ozan Oktay (Attention-Gated Networks) tarzı 2D grid attention’ın sadeleştirilmiş hali.
    x: skip/feature (B,C,H,W)
    g: gating signal (B,Cg,Hg,Wg)  (genelde daha derin katman)
    çıktı: gated_x, att_map
    """
    def __init__(
        self,
        in_channels: int,
        gating_channels: int,
        inter_channels: int | None = None,
        sub_sample_factor: int = 2,
    ):
        super().__init__()
        if inter_channels is None:
            inter_channels = max(in_channels // 2, 1)

        self.in_channels = in_channels
        self.gating_channels = gating_channels
        self.inter_channels = inter_channels

       
        self.theta = nn.Conv2d(in_channels, inter_channels, kernel_size=2, stride=sub_sample_factor, padding=0, bias=False)

       
        self.phi = nn.Conv2d(gating_channels, inter_channels, kernel_size=1, stride=1, padding=0, bias=True)


        self.psi = nn.Conv2d(inter_channels, 1, kernel_size=1, stride=1, padding=0, bias=True)

        self.W = nn.Sequential(
            nn.Conv2d(in_channels, in_channels, kernel_size=1, stride=1, padding=0, bias=False),
            nn.BatchNorm2d(in_channels),
        )

        self.relu = nn.ReLU(inplace=True)
        self.sigmoid = nn.Sigmoid()

    def forward(self, x: torch.Tensor, g: torch.Tensor):
   

        theta_x = self.theta(x) 

        
        phi_g = self.phi(g)
        if phi_g.shape[-2:] != theta_x.shape[-2:]:
            phi_g = F.interpolate(phi_g, size=theta_x.shape[-2:], mode="bilinear", align_corners=False)

        f = self.relu(theta_x + phi_g)          
        psi_f = self.psi(f)                     
        att = self.sigmoid(psi_f)              

       
        att_up = att
        if att_up.shape[-2:] != x.shape[-2:]:
            att_up = F.interpolate(att_up, size=x.shape[-2:], mode="bilinear", align_corners=False)

        y = att_up * x                        
        y = self.W(y)
        return y, att_up
